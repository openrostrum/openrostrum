import { useState } from "react";
import { textLength } from "~/lib/format";
import { RichText } from "~/ui/rich-text-lazy";

/**
 * Labeled rich-text field with a character counter — composes the canonical
 * `~/ui` RichText (app/components composes primitives, it never defines
 * skins). The server re-sanitizes on write regardless.
 */
export function RichTextEditor({
	name,
	defaultValue = "",
	maxLength,
	label,
	error,
}: {
	name: string;
	defaultValue?: string;
	maxLength?: number;
	label: string;
	error?: string;
}) {
	const [chars, setChars] = useState(() => textLength(defaultValue));
	return (
		<div className="flex flex-col gap-[5px] text-[12.5px]">
			<span className="font-medium text-fg-muted">{label}</span>
			<RichText
				name={name}
				defaultValue={defaultValue}
				invalid={Boolean(error)}
				ariaLabel={label}
				onChange={(html) => setChars(textLength(html))}
			/>
			<div className="flex justify-between">
				{error ? (
					<span className="text-[11.5px] text-danger">{error}</span>
				) : (
					<span />
				)}
				{maxLength !== undefined && (
					<span className="font-mono text-[11px] tabular-nums text-fg-faint">
						{chars.toLocaleString()}/{maxLength.toLocaleString()}
					</span>
				)}
			</div>
		</div>
	);
}
