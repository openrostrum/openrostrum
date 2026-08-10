import { eq } from "drizzle-orm";
import { Form, data, useNavigation } from "react-router";
import { getDb } from "~/db";
import { events } from "~/db/schema";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import {
	eventDetailsValues,
	isSlugTakenError,
	parseEventDetails,
	SLUG_TAKEN_MESSAGE,
} from "~/settings/event-details.server";
import {
	EVENT_IMAGE,
	EVENT_IMAGE_ACCEPT,
	EventDetailsFields,
	type EventDetailsErrors,
	type EventDetailsValues,
	type EventImageKind,
} from "~/settings/event-form";
import {
	Button,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	StatusBadge,
} from "~/ui";
import type { Route } from "./+types/admin.settings._index";

const IMAGE_TYPES: Record<string, true> = {
	"image/png": true,
	"image/jpeg": true,
	"image/webp": true,
	"image/gif": true,
};

type ImagePreview = { dataUri: string; fileName: string; sizeLabel: string };

type ActionResult = {
	intent: "details" | "image";
	kind?: EventImageKind;
	ok?: boolean;
	formError?: string;
	imageError?: string;
	fieldErrors?: EventDetailsErrors;
	values?: EventDetailsValues;
};

// Without this export, RR7 drops loader/action headers from DOCUMENT
// responses — Server-Timing would silently vanish on full page loads.
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

// Keeps every plain return widened to the one ActionResult shape, so the
// component can read optional keys off any branch of the union.
function res(r: ActionResult): ActionResult {
	return r;
}

function toBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

async function imagePreview(
	env: Env,
	key: string | null,
): Promise<ImagePreview | null> {
	if (!key) return null;
	const object = await env.BLOBS.get(key);
	if (!object) return null;
	const bytes = await object.arrayBuffer();
	const contentType = object.httpMetadata?.contentType ?? "image/png";
	return {
		// Inline data: URI — serving branding bytes by URL is the shared file
		// route's contract, not this page's; the upload caps bound the payload.
		dataUri: `data:${contentType};base64,${toBase64(bytes)}`,
		fileName: key.split("/").pop() ?? "image",
		sizeLabel: formatBytes(bytes.byteLength),
	};
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on layout loaders.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return { event: null, values: null, images: null };
	}
	const timings = createTimings();
	const images = await timings.time("r2", async () => ({
		logo: await imagePreview(env, event.logoKey),
		background: await imagePreview(env, event.backgroundKey),
	}));
	return data(
		{
			event: { id: event.id },
			values: eventDetailsValues(event),
			images,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not run any layout loader.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return res({
			intent: "details",
			formError: "There is no event to configure yet — create one first.",
		});
	}
	const db = getDb(env);
	const form = await request.formData();
	const intent = form.get("intent");
	const timings = createTimings();

	if (intent === "details") {
		const parsed = parseEventDetails(form);
		if (!parsed.ok) {
			return res({
				intent: "details",
				fieldErrors: parsed.fieldErrors,
				values: parsed.values,
			});
		}
		try {
			await timings.time("db", () =>
				db.update(events).set(parsed.data).where(eq(events.id, event.id)),
			);
		} catch (error) {
			if (isSlugTakenError(error)) {
				return res({
					intent: "details",
					fieldErrors: { slug: [SLUG_TAKEN_MESSAGE] },
					values: parsed.values,
				});
			}
			track("event.settings_update_failed", {
				eventId: event.id,
				error: errorMessage(error),
			});
			return res({
				intent: "details",
				formError: "Could not save the event details — please try again.",
				values: parsed.values,
			});
		}
		track("event.settings_updated", { eventId: event.id });
		return data(res({ intent: "details", ok: true }), {
			headers: { "Server-Timing": timings.header() },
		});
	}

	if (intent === "image.upload" || intent === "image.remove") {
		const kind = form.get("kind");
		if (kind !== "logo" && kind !== "background") {
			return res({ intent: "image", formError: "Unknown image kind." });
		}
		const currentKey = kind === "logo" ? event.logoKey : event.backgroundKey;
		const column = kind === "logo" ? "logoKey" : "backgroundKey";

		if (intent === "image.remove") {
			await timings.time("db", () =>
				db
					.update(events)
					.set({ [column]: null })
					.where(eq(events.id, event.id)),
			);
			// The row no longer points at the object; a failed R2 delete only
			// leaks storage and must not fail a removal that already happened.
			if (currentKey) {
				try {
					await env.BLOBS.delete(currentKey);
				} catch (error) {
					track("event.image_cleanup_failed", {
						eventId: event.id,
						kind,
						error: errorMessage(error),
					});
				}
			}
			track("event.image_removed", { eventId: event.id, kind });
			return data(res({ intent: "image", kind, ok: true }), {
				headers: { "Server-Timing": timings.header() },
			});
		}

		const file = form.get("file");
		if (!(file instanceof File) || file.size === 0) {
			return res({
				intent: "image",
				kind,
				imageError: "Choose an image first.",
			});
		}
		if (!IMAGE_TYPES[file.type]) {
			return res({
				intent: "image",
				kind,
				imageError: "Use a PNG, JPEG, WebP, or GIF image.",
			});
		}
		if (file.size > EVENT_IMAGE[kind].maxBytes) {
			return res({
				intent: "image",
				kind,
				imageError: `That file is ${formatBytes(file.size)} — the ${EVENT_IMAGE[
					kind
				].label.toLowerCase()} must be ${formatBytes(
					EVENT_IMAGE[kind].maxBytes,
				)} or smaller.`,
			});
		}
		const safeName =
			file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80) || "image";
		const key = `event-assets/${event.id}/${kind}/${crypto.randomUUID()}/${safeName}`;
		try {
			await timings.time("r2", async () => {
				await env.BLOBS.put(key, await file.arrayBuffer(), {
					httpMetadata: { contentType: file.type },
				});
			});
			await timings.time("db", () =>
				db
					.update(events)
					.set({ [column]: key })
					.where(eq(events.id, event.id)),
			);
		} catch (error) {
			track("event.image_upload_failed", {
				eventId: event.id,
				kind,
				error: errorMessage(error),
			});
			return res({
				intent: "image",
				kind,
				imageError: "Could not store the image — please try again.",
			});
		}
		// The replaced object is unreachable once the row points elsewhere;
		// losing this delete only leaks storage, never correctness.
		if (currentKey) {
			try {
				await env.BLOBS.delete(currentKey);
			} catch (error) {
				track("event.image_cleanup_failed", {
					eventId: event.id,
					kind,
					error: errorMessage(error),
				});
			}
		}
		track("event.image_uploaded", {
			eventId: event.id,
			kind,
			sizeBytes: file.size,
		});
		return data(res({ intent: "image", kind, ok: true }), {
			headers: { "Server-Timing": timings.header() },
		});
	}

	return res({ intent: "details", formError: "Unknown action." });
}

function ImageBlock({
	kind,
	preview,
	result,
	busy,
}: {
	kind: EventImageKind;
	preview: ImagePreview | null;
	result: ActionResult | undefined;
	busy: boolean;
}) {
	const mine = result?.intent === "image" && result.kind === kind;
	const spec = EVENT_IMAGE[kind];
	return (
		<div className="flex min-w-[260px] flex-1 flex-col gap-3">
			<Form
				method="post"
				encType="multipart/form-data"
				className="flex flex-col gap-2"
			>
				<Input type="hidden" name="kind" defaultValue={kind} />
				<Field label={spec.label} error={mine ? result?.imageError : undefined}>
					<Input type="file" name="file" accept={EVENT_IMAGE_ACCEPT} required />
				</Field>
				<p>
					{spec.hint}. PNG, JPEG, WebP or GIF up to{" "}
					{Math.round(spec.maxBytes / (1024 * 1024))} MB.
				</p>
				<div className="flex items-center gap-2">
					<Button
						type="submit"
						name="intent"
						value="image.upload"
						variant="ghost"
						icon="export"
						disabled={busy}
					>
						Upload {spec.label.toLowerCase()}
					</Button>
					{mine && result?.ok && !busy && (
						<StatusBadge tone="success">Saved</StatusBadge>
					)}
				</div>
			</Form>
			{preview && (
				<div className="flex flex-col gap-2">
					<img
						src={preview.dataUri}
						alt={`Current event ${kind}`}
						className="max-h-[120px] w-fit max-w-full"
					/>
					<p>
						{preview.fileName} · {preview.sizeLabel}
					</p>
					<Form method="post">
						<Input type="hidden" name="kind" defaultValue={kind} />
						<Button
							type="submit"
							name="intent"
							value="image.remove"
							variant="ghost"
							disabled={busy}
						>
							Remove
						</Button>
					</Form>
				</div>
			)}
		</div>
	);
}

export default function EventDetails({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const busy = useNavigation().state !== "idle";
	const { event, values, images } = loaderData;
	const details = actionData?.intent === "details" ? actionData : undefined;

	// The layout renders the no-event empty state; nothing to show here.
	if (!event) return null;

	return (
		<div className="flex flex-col gap-5">
			<Panel>
				<Form method="post" className="flex flex-col gap-[13px]">
					<EventDetailsFields
						values={details?.values ?? values}
						errors={details?.fieldErrors}
					/>
					<div className="flex items-center gap-3">
						<Button type="submit" name="intent" value="details" disabled={busy}>
							Save changes
						</Button>
						{details?.ok && !busy && (
							<StatusBadge tone="success">Saved</StatusBadge>
						)}
						{details?.formError && <ErrorText>{details.formError}</ErrorText>}
					</div>
				</Form>
			</Panel>
			<Panel>
				<div className="flex flex-col gap-4">
					<PageHeader
						title="Images"
						subtitle="Branding shown on your submission forms, portal, and emails."
					/>
					<div className="flex flex-wrap gap-7">
						<ImageBlock
							kind="logo"
							preview={images?.logo ?? null}
							result={actionData}
							busy={busy}
						/>
						<ImageBlock
							kind="background"
							preview={images?.background ?? null}
							result={actionData}
							busy={busy}
						/>
					</div>
				</div>
			</Panel>
		</div>
	);
}

export function ErrorBoundary() {
	// Generic message only — never render the raw error.
	return (
		<Panel>
			<PageHeader
				title="Failed to load event details"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</Panel>
	);
}
