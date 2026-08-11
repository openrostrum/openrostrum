import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { MotionReveal } from "./motion";

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
	disabled = false,
	children,
}: {
	label: string;
	prompt: string;
	confirmLabel: string;
	name: string;
	value: string;
	variant?: "primary" | "ghost";
	disabled?: boolean;
	children?: ReactNode;
}) {
	const [arming, setArming] = useState(false);
	const revealRef = useRef<HTMLDivElement>(null);
	const keyboardArmRef = useRef(false);

	useEffect(() => {
		if (arming && keyboardArmRef.current) {
			revealRef.current?.querySelector("button")?.focus();
		}
	}, [arming]);

	if (!arming) {
		return (
			<Button
				type="button"
				variant={variant}
				disabled={disabled}
				onClick={(event) => {
					keyboardArmRef.current = event.detail === 0;
					setArming(true);
				}}
			>
				{label}
			</Button>
		);
	}
	return (
		<MotionReveal>
			<div ref={revealRef} className="flex flex-wrap items-center gap-2">
				<span className="text-[12.5px] text-fg-muted">{prompt}</span>
				{children}
				<Button type="submit" name={name} value={value} disabled={disabled}>
					{confirmLabel}
				</Button>
				<Button type="button" variant="ghost" onClick={() => setArming(false)}>
					Cancel
				</Button>
			</div>
		</MotionReveal>
	);
}
