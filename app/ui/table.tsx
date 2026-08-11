import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "./cn";

export function Table({ children }: { children: ReactNode }) {
	return (
		<div className="overflow-x-auto rounded-card bg-surface shadow-card">
			<table className="w-full border-collapse text-left">{children}</table>
		</div>
	);
}

export function THead({ children }: { children: ReactNode }) {
	return (
		<thead className="bg-thead">
			<tr>{children}</tr>
		</thead>
	);
}

export function Th({ children }: { children?: ReactNode }) {
	return (
		<th className="whitespace-nowrap border-b border-hair px-[14px] py-[10px] text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
			{children}
		</th>
	);
}

export function TBody({ children }: { children: ReactNode }) {
	return <tbody>{children}</tbody>;
}

type TrProps = Omit<ComponentPropsWithoutRef<"tr">, "className"> & {
	selected?: boolean;
	interactive?: boolean;
};

export function Tr({ selected, interactive, children, ...props }: TrProps) {
	return (
		<tr
			{...props}
			className={cn(
				"transition-colors duration-100 hover:bg-row-hover",
				interactive && "cursor-pointer",
				// Selection = wash + ONE 2px petrol rule on the leading edge only
				// (a per-cell shadow leaks ticks at every column boundary).
				selected &&
					"bg-row-selected [&>td:first-child]:shadow-[inset_2px_0_0_var(--color-petrol)]",
			)}
		>
			{children}
		</tr>
	);
}

const CELLS = {
	default: "text-fg-muted",
	strong: "font-medium text-fg",
	mono: "font-mono text-[12px] tabular-nums text-fg-muted",
} as const;

export function Td({
	kind = "default",
	children,
}: {
	kind?: keyof typeof CELLS;
	children?: ReactNode;
}) {
	return (
		<td
			className={cn(
				"h-[46px] whitespace-nowrap border-t border-hair px-[14px] align-middle text-[13px] first:border-t-0",
				CELLS[kind],
			)}
		>
			{children}
		</td>
	);
}

export function EmptyRow({
	colSpan,
	children,
}: {
	colSpan: number;
	children: ReactNode;
}) {
	return (
		<tr>
			<td
				colSpan={colSpan}
				className="border-t border-hair px-[14px] py-10 text-center text-[13px] text-fg-muted"
			>
				{children}
			</td>
		</tr>
	);
}

export function TableFooter({ children }: { children: ReactNode }) {
	return (
		<div className="flex items-center border-t border-hair px-[14px] py-[9px] font-mono text-[11.5px] text-fg-muted">
			{children}
		</div>
	);
}
