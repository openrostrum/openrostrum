import type { ReactNode } from "react";
import { Panel } from "~/ui";
import { cn } from "~/ui/cn";

/**
 * Portal view pieces. Every color is a theme token and ~/ui primitives are
 * composed wherever one exists, so a re-skin stays a token/app-ui edit.
 */

/** Panel with a heading row — the portal's card composition unit. */
export function Card({
	title,
	count,
	action,
	children,
}: {
	title: string;
	count?: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<Panel>
			<section className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h3 className="text-[13px] font-semibold text-fg">
						{title}
						{count !== undefined && (
							<span className="ml-2 font-mono text-[11.5px] font-medium text-fg-muted">
								{count}
							</span>
						)}
					</h3>
					{action}
				</div>
				<div>{children}</div>
			</section>
		</Panel>
	);
}

export function RowList({ children }: { children: ReactNode }) {
	return <ul className="flex flex-col">{children}</ul>;
}

export function Row({
	children,
	right,
}: {
	children: ReactNode;
	right?: ReactNode;
}) {
	return (
		<li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-hair py-[9px] last:border-b-0">
			<div className="min-w-0 flex-1">{children}</div>
			{right && <div className="flex items-center gap-2">{right}</div>}
		</li>
	);
}

export function Muted({
	children,
	tone = "muted",
}: {
	children: ReactNode;
	tone?: "muted" | "faint" | "danger";
}) {
	return (
		<span
			className={cn(
				"text-[12px]",
				tone === "muted" && "text-fg-muted",
				tone === "faint" && "text-fg-faint",
				tone === "danger" && "text-danger",
			)}
		>
			{children}
		</span>
	);
}

export function Strong({ children }: { children: ReactNode }) {
	return <span className="text-[13px] font-medium text-fg">{children}</span>;
}

/**
 * Inline notice — closed windows, denials, success feedback. Neutral chip
 * ground for every tone: petrol is reserved for wayfinding/selection (the
 * petrol law), so success is carried by the copy, danger by the text color.
 */
export function Notice({
	tone,
	children,
}: {
	tone: "info" | "success" | "danger";
	children: ReactNode;
}) {
	return (
		<div
			role={tone === "danger" ? "alert" : "status"}
			className={cn(
				"rounded-control bg-chip px-3 py-2 text-[12.5px]",
				tone === "danger" ? "text-danger" : "text-fg-muted",
			)}
		>
			{tone === "success" ? <>✓ {children}</> : children}
		</div>
	);
}

/** Label:value pairs for detail metadata. */
export function MetaGrid({
	items,
}: {
	items: Array<{ label: string; value: ReactNode } | null>;
}) {
	const visible = items.filter((i) => i !== null);
	if (visible.length === 0) return null;
	return (
		<dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
			{visible.map((item) => (
				<div key={item.label} className="flex flex-col gap-0.5">
					<dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-faint">
						{item.label}
					</dt>
					<dd className="text-[13px] text-fg">{item.value}</dd>
				</div>
			))}
		</dl>
	);
}

/** Portal page footer strip (logged-in-as line). */
export function FooterNote({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-wrap items-center gap-1 py-4 text-[12px] text-fg-muted">
			{children}
		</div>
	);
}

/** Local pill toggle (client state, not navigation). */
export function PillToggle({
	label,
	active,
	onSelect,
}: {
	label: string;
	active: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onSelect}
			className={cn(
				"rounded-full px-[10px] py-[3px] text-[12px] font-medium transition-[background-color,color,transform] [transition-duration:var(--motion-duration-feedback)] [transition-timing-function:var(--ease-gallery-responsive)] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol",
				active ? "bg-petrol-wash text-petrol" : "text-fg-muted hover:bg-chip",
			)}
		>
			{label}
		</button>
	);
}
