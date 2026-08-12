import type { CSSProperties, ReactNode } from "react";
import { isRouteErrorResponse } from "react-router";
import { ThemeToggle } from "~/components/theme-toggle";
import { ButtonLink, EmptyState, InkLink, Mark, Tab, Tabs } from "~/ui";
import type { ProgramEvent } from "~/lib/program-types";

/**
 * Chrome for the anonymous program surfaces. Like app/marketing, this is a
 * public-facing composition layer on the SAME @theme tokens as the admin skin
 * — petrol stays the only accent (wayfinding + selection), every color is a
 * token, so a re-skin still needs zero diffs here beyond app/app.css + app/ui.
 */

export const PROGRAM_SURFACES = [
	{ key: "sessions", label: "Sessions", path: "sessions" },
	{ key: "speakers", label: "Speakers", path: "speakers" },
	{ key: "schedule", label: "Agenda", path: "schedule" },
	{ key: "itinerary", label: "Itinerary", path: "itinerary" },
	{ key: "gallery", label: "Gallery", path: "gallery" },
] as const;

export type SurfaceKey = (typeof PROGRAM_SURFACES)[number]["key"];

export function ProgramShell({
	event,
	active,
	children,
}: {
	event: ProgramEvent;
	active: SurfaceKey;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-screen flex-col">
			<header className="mx-auto w-full max-w-5xl px-5 pt-8 md:px-8">
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<h1 className="font-display text-[26px] font-semibold tracking-[-0.01em] text-fg">
							{event.name}
						</h1>
						{(event.dateRange || event.location) && (
							<p className="mt-1 text-[13.5px] text-fg-muted">
								{[event.dateRange, event.location].filter(Boolean).join(" · ")}
							</p>
						)}
					</div>
					<ThemeToggle placement="below" />
				</div>
				<nav aria-label="Program" className="mt-5 overflow-x-auto">
					<Tabs>
						{PROGRAM_SURFACES.map((surface) => (
							<Tab
								key={surface.key}
								to={`/${surface.path}/${event.slug}`}
								active={surface.key === active}
							>
								{surface.label}
							</Tab>
						))}
					</Tabs>
				</nav>
			</header>
			<main className="mx-auto w-full max-w-5xl flex-1 px-5 py-6 md:px-8">
				{children}
			</main>
			<ProgramFooter />
		</div>
	);
}

/** Minimal chrome for /embed/:publicId — no site nav, just attribution. */
export function EmbedShell({
	event,
	children,
}: {
	event: ProgramEvent;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-screen flex-col">
			<header className="mx-auto w-full max-w-5xl px-4 pt-5 md:px-6">
				<p className="font-display text-[17px] font-semibold text-fg">
					{event.name}
				</p>
				{event.dateRange && (
					<p className="mt-0.5 text-[12.5px] text-fg-muted">
						{event.dateRange}
					</p>
				)}
			</header>
			<main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4 md:px-6">
				{children}
			</main>
			<ProgramFooter />
		</div>
	);
}

/** Shared error screen for the public surfaces — generic copy, never the raw error. */
export function ProgramErrorScreen({ error }: { error: unknown }) {
	const notFound = isRouteErrorResponse(error) && error.status === 404;
	return (
		<div className="flex min-h-screen flex-col">
			<main className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-5 py-16">
				<EmptyState
					icon="calendar"
					title={notFound ? "Event not found" : "Something went wrong"}
					body={
						notFound
							? "There's no event at this address — check the link, or browse from the homepage."
							: "This page failed to load. Please refresh or try again in a moment."
					}
					action={
						<ButtonLink to="/" variant="ghost">
							Go to homepage
						</ButtonLink>
					}
				/>
			</main>
			<ProgramFooter />
		</div>
	);
}

/**
 * Scopes an embed's configured brand color: replaces the accent tokens for
 * everything inside. The color is organizer data, not a skin decision.
 */
export function AccentScope({
	color,
	children,
}: {
	color: string | null;
	children: ReactNode;
}) {
	if (!color) return <>{children}</>;
	return (
		<div
			style={
				{
					"--color-petrol": color,
					"--color-petrol-hover": color,
				} as CSSProperties
			}
		>
			{children}
		</div>
	);
}

/** Designed gate for agenda-backed surfaces before the organizer publishes. */
export function AgendaUnpublished({ event }: { event: ProgramEvent }) {
	return (
		<EmptyState
			icon="calendar"
			title="The agenda isn't published yet"
			body={`The organizers of ${event.name} haven't published the schedule. Check back soon.`}
		/>
	);
}

function ProgramFooter() {
	return (
		<footer className="border-t border-hair">
			<div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-5 py-4 text-[12px] text-fg-muted md:px-8">
				<Mark size={15} />
				<span>
					Powered by{" "}
					<InkLink to="/" strong>
						OpenRostrum
					</InkLink>
				</span>
			</div>
		</footer>
	);
}
