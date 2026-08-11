import { useId, type ReactNode } from "react";
import { Button } from "./button";
import { DialogSurface } from "./motion";

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
		<DialogSurface labelledBy={titleId} onDismiss={onClose}>
			<div className="flex flex-col gap-4">
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
		</DialogSurface>
	);
}
