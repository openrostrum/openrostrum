import { MOTION_FEEDBACK } from "~/ui/motion-classes";
import { useState } from "react";
import { Icon } from "~/ui";

/**
 * File input styled as a drop-zone-ish control. Always states the accepted
 * types + max size (constraint copy is part of the contract, not decoration —
 * see the upload rules the server enforces in the owning action).
 */
export function FilePicker({
	name,
	accept,
	constraints,
	required,
}: {
	name: string;
	accept: string;
	/** Human copy, e.g. "PNG or JPEG, up to 5 MB." */
	constraints: string;
	required?: boolean;
}) {
	const [fileName, setFileName] = useState<string | null>(null);
	return (
		<label
			className={`flex cursor-pointer flex-col items-center gap-1 rounded-card border border-dashed border-hair-strong px-4 py-5 text-center transition-colors ${MOTION_FEEDBACK} hover:bg-chip focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-petrol`}
		>
			<input
				type="file"
				name={name}
				accept={accept}
				required={required}
				className="sr-only"
				onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
			/>
			<span className="flex items-center gap-2 text-[13px] font-medium text-fg">
				<Icon name="export" size={14} />
				{fileName ?? "Choose a file"}
			</span>
			<span className="text-[12px] text-fg-muted">{constraints}</span>
		</label>
	);
}
