import { useId, type ReactNode } from "react";
import { Button } from "./button";

export function Modal({
	open,
	title,
	subtitle,
	onClose,
	actions,
	children,
}: {
	open: boolean;
	title: string;
	subtitle?: string;
	onClose: () => void;
	actions?: ReactNode;
	children: ReactNode;
}) {
	const titleId = useId();
	if (!open) return null;
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.42)] p-4"
			role="presentation"
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				className="flex max-h-[92vh] w-full max-w-4xl flex-col gap-4 overflow-y-auto rounded-card bg-surface p-5 shadow-card"
			>
				<div className="flex items-start justify-between gap-4">
					<div>
						<h2
							id={titleId}
							className="font-display text-[21px] font-semibold text-fg"
						>
							{title}
						</h2>
						{subtitle && (
							<p className="text-[13px] text-fg-muted">{subtitle}</p>
						)}
					</div>
					<Button type="button" variant="ghost" onClick={onClose}>
						Cancel
					</Button>
				</div>
				{children}
				{actions && (
					<div className="flex flex-wrap items-center justify-end gap-3 border-t border-hair pt-4">
						{actions}
					</div>
				)}
			</div>
		</div>
	);
}
