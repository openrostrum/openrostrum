import { type JSX, useEffect, useState } from "react";
import { Button } from "~/ui";
import type { IconName } from "~/ui/icon";

export type CopyButtonProps = {
	value: string;
	label?: string;
	copiedLabel?: string;
	failedLabel?: string | null;
	resetAfterMs?: number | null;
	icon?: IconName | null;
	optimistic?: boolean;
	onFailure?: () => void;
};

export function attemptClipboardWrite(
	value: string,
	onFailure?: () => void,
): Promise<void> | undefined {
	const clipboard = navigator.clipboard;
	if (!clipboard) {
		onFailure?.();
		return;
	}
	try {
		return clipboard.writeText(value);
	} catch {
		onFailure?.();
	}
}

export async function handleClipboardFeedback(
	write: Promise<void> | undefined,
	{
		optimistic,
		showFailure,
		onFeedback,
		onFailure,
	}: {
		optimistic: boolean;
		showFailure: boolean;
		onFeedback: (feedback: "copied" | "failed") => void;
		onFailure?: () => void;
	},
): Promise<void> {
	if (!write) return;
	if (optimistic) onFeedback("copied");
	try {
		await write;
		if (!optimistic) onFeedback("copied");
	} catch {
		onFailure?.();
		if (!optimistic && showFailure) onFeedback("failed");
	}
}

export function CopyButton({
	value,
	label = "Copy",
	copiedLabel = "Copied!",
	failedLabel = "Copy failed",
	resetAfterMs = 2500,
	icon = "export",
	optimistic = false,
	onFailure,
}: CopyButtonProps): JSX.Element {
	const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

	useEffect(() => {
		if (state === "idle" || resetAfterMs === null) return;
		const timeout = setTimeout(() => setState("idle"), resetAfterMs);
		return () => clearTimeout(timeout);
	}, [resetAfterMs, state]);

	function copy() {
		const write = attemptClipboardWrite(value, onFailure);
		void handleClipboardFeedback(write, {
			optimistic,
			showFailure: failedLabel !== null,
			onFeedback: setState,
			onFailure,
		});
	}

	return (
		<Button
			type="button"
			variant="ghost"
			icon={icon ?? undefined}
			onClick={copy}
		>
			{state === "copied"
				? copiedLabel
				: state === "failed"
					? failedLabel
					: label}
		</Button>
	);
}
