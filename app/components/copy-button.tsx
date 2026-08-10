import { useEffect, useState } from "react";
import { Button } from "~/ui";

/**
 * The shared copy-to-clipboard button. Two earlier per-surface copies exist —
 * `CopyFieldButton` (app/widgets/bits.tsx, owner-locked) and the forms
 * editor's local `CopyLinkButton` — and consolidating them onto this one is
 * an integration-sweep item; new features compose this, never a fourth copy.
 */
export function CopyButton({
	value,
	label = "Copy",
	failedLabel = "Copy failed",
}: {
	value: string;
	/** Idle label — name what gets copied (e.g. "Copy CFP link"). */
	label?: string;
	failedLabel?: string;
}) {
	const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
	useEffect(() => {
		if (state === "idle") return;
		const t = setTimeout(() => setState("idle"), 2500);
		return () => clearTimeout(t);
	}, [state]);
	return (
		<Button
			type="button"
			variant="ghost"
			icon="export"
			onClick={() => {
				navigator.clipboard
					?.writeText(value)
					.then(() => setState("copied"))
					.catch(() => setState("failed"));
			}}
		>
			{state === "copied"
				? "Copied!"
				: state === "failed"
					? failedLabel
					: label}
		</Button>
	);
}
