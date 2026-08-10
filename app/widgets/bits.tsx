import { type ReactNode, useState } from "react";
import { Avatar, Button, ButtonLink, Icon } from "~/ui";
import { cn } from "~/ui/cn";

/** Build an href from a base path + query params, dropping empty values. */
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

/** Headshot when one exists, deterministic initials otherwise. */
export function SpeakerPhoto({
	name,
	photoUrl,
	size = 32,
}: {
	name: string;
	photoUrl: string | null;
	size?: number;
}) {
	if (photoUrl) {
		return (
			<img
				src={photoUrl}
				alt={name}
				width={size}
				height={size}
				loading="lazy"
				className="shrink-0 rounded-full bg-chip object-cover"
				style={{ width: size, height: size }}
			/>
		);
	}
	return <Avatar name={name} size={size} />;
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

/** Hidden form value — routes compose this instead of a raw input element. */
export function HiddenField({ name, value }: { name: string; value: string }) {
	return <input type="hidden" name={name} value={value} />;
}

/** Labeled checkbox for multi-pick config groups (tracks, formats, fields). */
export function CheckboxOption({
	name,
	value,
	label,
	defaultChecked,
}: {
	name: string;
	value: string;
	label: string;
	defaultChecked: boolean;
}) {
	return (
		<label className="flex items-center gap-2 text-[13px] text-fg">
			<input
				type="checkbox"
				name={name}
				value={value}
				defaultChecked={defaultChecked}
				className="h-4 w-4 accent-petrol"
			/>
			{label}
		</label>
	);
}

/** Copies a value and confirms inline — snippets must cost one click, not a drag-select. */
export function CopyFieldButton({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<Button
			type="button"
			variant="ghost"
			onClick={() => {
				void navigator.clipboard.writeText(value).then(() => {
					setCopied(true);
					setTimeout(() => setCopied(false), 1600);
				});
			}}
		>
			{copied ? "Copied" : "Copy"}
		</Button>
	);
}
