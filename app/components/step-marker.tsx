import { Icon } from "~/ui";
import { cn } from "~/ui/cn";

/**
 * The numbered dot every ordered first-run list draws — the onboarding rail and
 * the dashboard's getting-started card share it so the two read as one spine
 * the organizer is still walking, not two unrelated widgets.
 */
export function StepMarker({
	index,
	done,
	active,
}: {
	index: number;
	done: boolean;
	active: boolean;
}) {
	if (done) {
		return (
			<span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-fg-faint">
				<Icon name="check-square" size={16} />
			</span>
		);
	}
	return (
		<span
			className={cn(
				"flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-medium tabular-nums",
				active
					? "bg-petrol-wash text-petrol"
					: "text-fg-faint shadow-[inset_0_0_0_1px_var(--color-hair-strong)]",
			)}
		>
			{index + 1}
		</span>
	);
}
