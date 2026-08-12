import { useState } from "react";
import { textLength } from "~/lib/format";
import { Field } from "~/ui";
import { RichText } from "~/ui/rich-text-lazy";

/**
 * Labeled rich-text field with a character counter — composes the canonical
 * `~/ui` Field and RichText (app/components composes primitives, it never
 * defines skins). The server re-sanitizes on write regardless.
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
		<Field
			label={label}
			error={error}
			composite
			aside={
				maxLength !== undefined && (
					<span className="font-mono text-[11px] tabular-nums text-fg-faint">
						{chars.toLocaleString()}/{maxLength.toLocaleString()}
					</span>
				)
			}
		>
			<RichText
				name={name}
				defaultValue={defaultValue}
				invalid={Boolean(error)}
				ariaLabel={label}
				onChange={(html) => setChars(textLength(html))}
			/>
		</Field>
	);
}
