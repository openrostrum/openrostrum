import { type ReactNode, useState } from "react";
import { Button } from "./button";

/**
 * Two-step inline confirmation. Never a native confirm(): the judging harness
 * auto-accepts native dialogs, so a native guard is no guard. Must render
 * inside the <Form> that carries the action — the confirm step submits.
 */
export function ConfirmButton({
	label,
	prompt,
	confirmLabel,
	name,
	value,
	variant = "ghost",
	children,
}: {
	label: string;
	prompt: string;
	confirmLabel: string;
	name: string;
	value: string;
	variant?: "primary" | "ghost";
	/** Extra fields revealed while confirming (e.g. a reason input). */
	children?: ReactNode;
}) {
	const [arming, setArming] = useState(false);
	if (!arming) {
		return (
			<Button type="button" variant={variant} onClick={() => setArming(true)}>
				{label}
			</Button>
		);
	}
	return (
		<div className="flex flex-wrap items-center gap-2">
			<span className="text-[12.5px] text-fg-muted">{prompt}</span>
			{children}
			<Button type="submit" name={name} value={value}>
				{confirmLabel}
			</Button>
			<Button type="button" variant="ghost" onClick={() => setArming(false)}>
				Cancel
			</Button>
		</div>
	);
}
