import { MOTION_FEEDBACK } from "~/ui/motion-classes";
import { type ReactNode, useState } from "react";
import { Avatar, ButtonLink, Icon } from "~/ui";
import { cn } from "~/ui/cn";

export function makeHref(
	base: string,
	params: Record<string, string | number | null | undefined>,
): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== null && value !== undefined && value !== "" && value !== 1) {
			search.set(key, String(value));
		}
	}
	const qs = search.toString();
	return qs ? `${base}?${qs}` : base;
}

/** Neutral tag (Format, Level, …) — track colors stay Chip's dot treatment. */
export function TagPill({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex items-center whitespace-nowrap rounded-full bg-chip px-[9px] py-[3px] text-[11.5px] font-medium text-fg-muted">
			{children}
		</span>
	);
}

export function ResultCount({ children }: { children: ReactNode }) {
	return (
		<p aria-live="polite" className="font-mono text-[11.5px] text-fg-muted">
			{children}
		</p>
	);
}

/** Truncated long text with an in-place Show more / Show less toggle. */
export function ShowMoreText({
	text,
	limit = 240,
}: {
	text: string;
	limit?: number;
}) {
	const [open, setOpen] = useState(false);
	if (!text) return null;
	if (text.length <= limit) {
		return (
			<p className="whitespace-pre-line text-[13.5px] leading-relaxed text-fg-muted">
				{text}
			</p>
		);
	}
	return (
		<div className="flex flex-col items-start gap-1">
			<p className="whitespace-pre-line text-[13.5px] leading-relaxed text-fg-muted">
				{open ? text : `${text.slice(0, limit).trimEnd()}…`}
			</p>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				className="rounded-[3px] text-[12.5px] font-medium text-petrol underline-offset-2 hover:text-petrol-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol"
			>
				{open ? "Show less" : "Show more"}
			</button>
		</div>
	);
}

/** Square gallery tile: photo, or an initials fallback that keeps the grid intact. */
export function PhotoTile({
	name,
	photoUrl,
}: {
	name: string;
	photoUrl: string | null;
}) {
	if (photoUrl) {
		return (
			<img
				src={photoUrl}
				alt={name}
				loading="lazy"
				className="aspect-square w-full rounded-card bg-chip object-cover"
			/>
		);
	}
	return (
		<div
			aria-hidden="true"
			className="flex aspect-square w-full items-center justify-center rounded-card bg-chip"
		>
			<Avatar name={name} size={72} />
		</div>
	);
}

export function Pagination({
	page,
	pages,
	makePageHref,
}: {
	page: number;
	pages: number;
	makePageHref: (page: number) => string;
}) {
	if (pages <= 1) return null;
	return (
		<nav
			aria-label="Pagination"
			className="flex items-center justify-between gap-3"
		>
			{page > 1 ? (
				<ButtonLink to={makePageHref(page - 1)} variant="ghost">
					Previous
				</ButtonLink>
			) : (
				<span />
			)}
			<span className="font-mono text-[11.5px] text-fg-muted">
				Page {page} of {pages}
			</span>
			{page < pages ? (
				<ButtonLink to={makePageHref(page + 1)} variant="ghost">
					Next
				</ButtonLink>
			) : (
				<span />
			)}
		</nav>
	);
}

/** Detail views are URL-driven so Back always restores the exact prior list state. */
export function DetailPanel({
	backHref,
	backLabel,
	children,
}: {
	backHref: string;
	backLabel: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-4">
			<div>
				<ButtonLink to={backHref} variant="ghost">
					← {backLabel}
				</ButtonLink>
			</div>
			<div className="rounded-card bg-surface p-5 shadow-card md:p-6">
				{children}
			</div>
		</section>
	);
}

export function MetaRow({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex gap-3 text-[13px]">
			<span className="w-20 shrink-0 text-[11px] font-semibold uppercase leading-6 tracking-[0.06em] text-fg-faint">
				{label}
			</span>
			<span className="leading-6 text-fg">{children}</span>
		</div>
	);
}

const STAR_BASE = cn(
	"flex h-8 w-8 shrink-0 items-center justify-center rounded-control",
	`transition-[background-color,color,transform] ${MOTION_FEEDBACK}`,
	"active:scale-[0.97] motion-reduce:active:scale-100",
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol",
);

export function StarButton({
	starred,
	onToggle,
	title,
}: {
	starred: boolean;
	onToggle: () => void;
	title: string;
}) {
	return (
		<button
			type="button"
			aria-pressed={starred}
			aria-label={
				starred
					? `Remove “${title}” from my schedule`
					: `Add “${title}” to my schedule`
			}
			onClick={onToggle}
			className={cn(
				STAR_BASE,
				starred
					? "bg-petrol-wash text-petrol"
					: "text-fg-faint hover:bg-chip hover:text-fg",
			)}
		>
			<Icon name="star" size={16} />
		</button>
	);
}
