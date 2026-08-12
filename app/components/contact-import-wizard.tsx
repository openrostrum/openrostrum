import type { ReactNode } from "react";
import { Form } from "react-router";
import {
	IMPORT_FIELDS,
	type ImportStep,
	MAX_ROWS,
	OUTCOME_TONE,
} from "~/lib/contact-import";
import { useBusy } from "~/lib/use-busy";
import {
	Button,
	ButtonLink,
	EmptyRow,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	Select,
	StatusBadge,
	Table,
	TBody,
	Td,
	Th,
	THead,
	Tr,
} from "~/ui";

/**
 * The CSV importer: upload → map columns → review probable duplicates → done.
 * Both import screens (event roster, organization directory) render THIS, so a
 * fix to the wizard can never land on one importer and miss the other.
 */
export interface ContactImportWizardProps {
	title: string;
	subtitle: string;
	/** Where "Back" and the final "View the roster" button go. */
	back: { to: string; label: string };
	done: { to: string; label: string };
	/** This page's own URL — "Start over" and "Import another file". */
	basePath: string;
	/** Extra controls on the upload step (e.g. picking a target event). */
	uploadFields?: ReactNode;
	/** Hidden inputs replayed on every later step, so a choice survives the wizard. */
	carryFields?: ReactNode;
	uploadHint: ReactNode;
	duplicateHint: string;
	state: ImportStep | undefined;
}

export function ContactImportWizard({
	title,
	subtitle,
	back,
	done,
	basePath,
	uploadFields,
	carryFields,
	uploadHint,
	duplicateHint,
	state,
}: ContactImportWizardProps) {
	const busy = useBusy();

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title={title}
				subtitle={subtitle}
				actions={
					<ButtonLink to={back.to} variant="ghost">
						{back.label}
					</ButtonLink>
				}
			/>

			{(!state || state.step === "upload") && (
				<Panel>
					<Form
						method="post"
						encType="multipart/form-data"
						className="flex flex-col gap-3"
					>
						{uploadFields}
						<Field label="CSV file">
							<Input type="file" name="file" accept=".csv,text/csv" />
						</Field>
						<p>{uploadHint}</p>
						<div className="flex items-center gap-3">
							<Button
								type="submit"
								name="intent"
								value="upload"
								icon="export"
								disabled={busy}
							>
								{busy ? "Uploading…" : "Upload and map columns"}
							</Button>
							{state?.formError && (
								<div role="alert">
									<ErrorText>{state.formError}</ErrorText>
								</div>
							)}
						</div>
					</Form>
				</Panel>
			)}

			{state?.step === "map" && (
				<Form method="post" className="flex flex-col gap-5">
					<Input type="hidden" name="csvB64" value={state.csvB64} readOnly />
					{carryFields}
					<Panel>
						<div className="flex flex-col gap-3">
							<strong>Map columns — {state.rowCount} data rows detected</strong>
							<div className="grid grid-cols-2 gap-3 md:grid-cols-3">
								{IMPORT_FIELDS.map((f) => (
									<Field
										key={f.key}
										label={f.required ? `${f.label} (required)` : f.label}
									>
										<Select
											name={`map_${f.key}`}
											defaultValue={
												state.guesses[f.key] === null
													? ""
													: String(state.guesses[f.key])
											}
										>
											<option value="">— skip —</option>
											{state.headers.map((h, idx) => (
												<option key={`${idx}-${h}`} value={idx}>
													{h || `Column ${idx + 1}`}
												</option>
											))}
										</Select>
									</Field>
								))}
							</div>
							<div className="flex items-center gap-3">
								<Button
									type="submit"
									name="intent"
									value="import"
									disabled={busy}
								>
									{busy ? "Importing…" : `Import ${state.rowCount} rows`}
								</Button>
								<ButtonLink to={basePath} variant="ghost">
									Start over
								</ButtonLink>
								{state.formError && (
									<div role="alert">
										<ErrorText>{state.formError}</ErrorText>
									</div>
								)}
							</div>
						</div>
					</Panel>

					<Table>
						<THead>
							{state.headers.map((h, idx) => (
								<Th key={`${idx}-${h}`}>{h || `Column ${idx + 1}`}</Th>
							))}
						</THead>
						<TBody>
							{state.preview.map((row, i) => (
								<Tr key={`preview-${i + 1}`}>
									{row.map((value, j) => (
										<Td key={`cell-${i + 1}-${j + 1}`}>
											{value.length > 40 ? `${value.slice(0, 40)}…` : value}
										</Td>
									))}
								</Tr>
							))}
						</TBody>
					</Table>
				</Form>
			)}

			{state?.step === "review" && (
				<Form method="post" className="flex flex-col gap-5">
					<Input type="hidden" name="intent" value="import" readOnly />
					<Input type="hidden" name="csvB64" value={state.csvB64} readOnly />
					{carryFields}
					{IMPORT_FIELDS.map((field) => {
						const index = state.mapping[field.key];
						return index === null || index === undefined ? null : (
							<Input
								key={field.key}
								type="hidden"
								name={`map_${field.key}`}
								value={String(index)}
								readOnly
							/>
						);
					})}
					<Panel>
						<div className="flex flex-col gap-3">
							<div>
								<strong>Review probable duplicates</strong>
								<p>{duplicateHint}</p>
							</div>
							<div className="flex items-center gap-3">
								<Button
									type="submit"
									name="duplicatePolicy"
									value="skip"
									disabled={busy}
								>
									{busy ? "Importing…" : "Import safe rows"}
								</Button>
								<Button
									type="submit"
									name="duplicatePolicy"
									value="create"
									variant="ghost"
									disabled={busy}
								>
									Create probable duplicates anyway
								</Button>
								<ButtonLink to={basePath} variant="ghost">
									Start over
								</ButtonLink>
							</div>
						</div>
					</Panel>

					<Table>
						<THead>
							<Th>Row</Th>
							<Th>Imported contact</Th>
							<Th>Existing contact</Th>
							<Th>Signal</Th>
						</THead>
						<TBody>
							{state.probableDuplicates.map((duplicate) => (
								<Tr key={duplicate.row}>
									<Td kind="mono">{duplicate.row}</Td>
									<Td>
										<div className="flex flex-col">
											<strong>{duplicate.name}</strong>
											<span>{duplicate.email}</span>
										</div>
									</Td>
									<Td kind="mono">{duplicate.existingEmail}</Td>
									<Td>
										<StatusBadge tone="caution">possible duplicate</StatusBadge>
									</Td>
								</Tr>
							))}
						</TBody>
					</Table>
				</Form>
			)}

			{state?.step === "done" && (
				<>
					<Panel>
						<div className="flex flex-col gap-2">
							<strong>Import complete</strong>
							<div className="flex flex-wrap items-center gap-4">
								<StatusBadge tone="success">{state.added} added</StatusBadge>
								{/* Only the organization importer can link — the roster
								    importer never shows a count that is always zero. */}
								{state.linked > 0 && (
									<StatusBadge tone="info">
										{state.linked} already in your directory
									</StatusBadge>
								)}
								<StatusBadge tone="info">
									{state.merged} merged by email
								</StatusBadge>
								<StatusBadge tone="caution">
									{state.skipped} skipped
								</StatusBadge>
							</div>
							{state.formError && (
								<div role="alert">
									<ErrorText>{state.formError}</ErrorText>
								</div>
							)}
							<div className="flex items-center gap-2">
								<ButtonLink to={done.to}>{done.label}</ButtonLink>
								<ButtonLink to={basePath} variant="ghost">
									Import another file
								</ButtonLink>
							</div>
						</div>
					</Panel>

					<Table>
						<THead>
							<Th>Row</Th>
							<Th>Name</Th>
							<Th>Email</Th>
							<Th>Outcome</Th>
							<Th>Reason</Th>
						</THead>
						<TBody>
							{state.results.map((r) => (
								<Tr key={r.row}>
									<Td kind="mono">{r.row}</Td>
									<Td kind="strong">{r.name || "—"}</Td>
									<Td kind="mono">{r.email || "—"}</Td>
									<Td>
										<StatusBadge tone={OUTCOME_TONE[r.outcome]}>
											{r.outcome}
										</StatusBadge>
									</Td>
									<Td>{r.reason}</Td>
								</Tr>
							))}
							{state.results.length === 0 && (
								<EmptyRow colSpan={5}>The file had no data rows.</EmptyRow>
							)}
						</TBody>
					</Table>
				</>
			)}
		</div>
	);
}

/** The row/size caps, phrased once for both importers' upload screens. */
export const IMPORT_LIMITS_HINT = `Up to ${MAX_ROWS} rows and 1 MB per import.`;
