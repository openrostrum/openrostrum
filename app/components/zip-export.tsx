import { useRef, useState } from "react";
import { z } from "zod";
import {
	beginZipExport,
	failZipExport,
	finishZipExport,
	idleZipExport,
	parseZipGrouping,
	type ZipExportState,
	type ZipGrouping,
	zipExportStatus,
} from "~/domain/zip-export";
import { useBusy } from "~/lib/use-busy";
import {
	Button,
	ErrorText,
	Field,
	Modal,
	MotionReveal,
	Select,
	StatusBadge,
} from "~/ui";

type Scope = "selected" | "all";

const PreflightResponse = z.union([
	z.object({ files: z.number(), totalBytes: z.number().optional() }),
	z.object({ error: z.string().min(1) }),
]);

export function ZipExportControls({
	selectedIds,
}: {
	selectedIds: readonly string[];
	hiddenSelectedIds?: readonly string[];
}) {
	const busy = useBusy();
	const [open, setOpen] = useState(false);
	const [scope, setScope] = useState<Scope>("selected");
	const [grouping, setGrouping] = useState<ZipGrouping>("session");
	const [state, setState] = useState(idleZipExport);
	const stateRef = useRef(idleZipExport());
	const exporting = state.phase === "building";
	const locked = exporting || busy;
	const status = zipExportStatus(state);
	const selectedLabel = `Download ZIP (${selectedIds.length} selected)`;
	const everythingLabel = "Download ZIP (everything)";
	const confirmLabel = scope === "all" ? everythingLabel : selectedLabel;

	function openWith(next: Scope) {
		if (exporting) return;
		setScope(next);
		setOpen(true);
	}

	function close() {
		if (exporting) return;
		setOpen(false);
	}

	function commit(next: ZipExportState) {
		stateRef.current = next;
		setState(next);
	}

	async function generate() {
		const current = stateRef.current;
		const next = beginZipExport(current);
		if (next === current) return;
		commit(next);
		if (scope === "selected" && selectedIds.length === 0) {
			commit(failZipExport(next, "Select at least one file to export."));
			return;
		}
		try {
			const response = await fetch(
				exportUrl({ ids: selectedIds, scope, grouping, preflight: true }),
			);
			const parsed = readPreflight(await response.json());
			if ("error" in parsed) {
				commit(failZipExport(next, parsed.error));
				return;
			}
			startZipDownload(
				exportUrl({ ids: selectedIds, scope, grouping, preflight: false }),
			);
			commit(finishZipExport(next, parsed.files));
		} catch {
			commit(failZipExport(next, "Could not start the ZIP download."));
		}
	}

	return (
		<>
			<div className="flex flex-wrap items-center gap-3">
				<Button
					type="button"
					icon="export"
					disabled={selectedIds.length === 0 || locked}
					onClick={() => openWith("selected")}
				>
					{selectedLabel}
				</Button>
				<Button
					type="button"
					variant="ghost"
					icon="export"
					disabled={locked}
					onClick={() => openWith("all")}
				>
					{everythingLabel}
				</Button>
				<span>
					Latest version of each file, grouped in one folder per session — or
					one flat folder.
				</span>
				<ExportStatus state={state} status={status} />
			</div>

			<Modal
				open={open}
				title="Export ZIP"
				subtitle="Latest versions only. Pick a folder grouping, then generate — a second click does nothing while a ZIP is building."
				onClose={close}
				actions={
					<>
						<span>{confirmLabel}</span>
						<Button
							type="button"
							disabled={locked}
							onClick={() => void generate()}
						>
							Generate Download
						</Button>
					</>
				}
			>
				<div className="flex flex-col gap-[13px]">
					<Field label="Include">
						<Select
							name="scope"
							value={scope}
							disabled={locked}
							aria-label="Include"
							onChange={(event) =>
								setScope(
									event.currentTarget.value === "all" ? "all" : "selected",
								)
							}
						>
							<option value="selected">
								Selected files ({selectedIds.length})
							</option>
							<option value="all">Every file in this event</option>
						</Select>
					</Field>
					<Field
						label="Folder grouping"
						hint="By session / speaker keeps one folder per talk. One flat folder puts every file in Files/."
					>
						<Select
							name="group"
							value={grouping}
							disabled={locked}
							aria-label="Folder grouping"
							onChange={(event) =>
								setGrouping(parseZipGrouping(event.currentTarget.value))
							}
						>
							<option value="session">By session / speaker</option>
							<option value="flat">One flat folder</option>
						</Select>
					</Field>
					<ExportStatus state={state} status={status} />
				</div>
			</Modal>
		</>
	);
}

function ExportStatus({
	state,
	status,
}: {
	state: ZipExportState;
	status: string | null;
}) {
	if (!status) return null;
	if (state.error) return <ErrorText>{status}</ErrorText>;
	if (state.phase === "started") {
		return (
			<MotionReveal kind="feedback">
				<span role="status">
					<StatusBadge tone="success">{status}</StatusBadge>
				</span>
			</MotionReveal>
		);
	}
	return (
		<span role="status">
			<StatusBadge tone="info">{status}</StatusBadge>
		</span>
	);
}

function exportUrl({
	ids,
	scope,
	grouping,
	preflight,
}: {
	ids: readonly string[];
	scope: Scope;
	grouping: ZipGrouping;
	preflight: boolean;
}): string {
	const params = new URLSearchParams();
	if (scope === "all") params.set("all", "1");
	else for (const id of ids) params.append("fileIds", id);
	params.set("group", grouping);
	if (preflight) params.set("preflight", "1");
	return `/admin/files/export.zip?${params}`;
}

function readPreflight(body: unknown): { files: number } | { error: string } {
	const parsed = PreflightResponse.safeParse(body);
	if (!parsed.success) return { error: "Could not start the ZIP download." };
	if ("error" in parsed.data) return { error: parsed.data.error };
	return { files: parsed.data.files };
}

function startZipDownload(url: string) {
	const frame = document.createElement("iframe");
	frame.hidden = true;
	frame.title = "ZIP download";
	frame.src = url;
	document.body.appendChild(frame);
	window.setTimeout(() => frame.remove(), 60_000);
}
