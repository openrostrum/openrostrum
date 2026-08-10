import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useState } from "react";
import { textLength } from "~/lib/format";

const TOOL =
	"flex h-7 min-w-7 items-center justify-center rounded-[5px] px-1.5 text-[12px] font-medium text-fg-muted hover:bg-chip hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol";
const TOOL_ON = "bg-petrol-wash text-petrol";

/**
 * The shared rich-text editor (SCOPE cross-cutting: one editor everywhere
 * Sessionboard shows WYSIWYG). Progressive form participation via a hidden
 * input carrying the HTML; the server re-sanitizes on write regardless.
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
	const [html, setHtml] = useState(defaultValue);
	const [chars, setChars] = useState(() => textLength(defaultValue));
	const editor = useEditor({
		extensions: [StarterKit],
		content: defaultValue,
		immediatelyRender: false,
		onUpdate({ editor: e }) {
			setHtml(e.isEmpty ? "" : e.getHTML());
			setChars(e.state.doc.textContent.length);
		},
	});

	const toggle = (fn: () => boolean | undefined) => () => {
		fn();
	};

	return (
		<div className="flex flex-col gap-[5px] text-[12.5px]">
			<span className="font-medium text-fg-muted">{label}</span>
			<div className="rounded-control bg-surface shadow-control">
				<div className="flex items-center gap-0.5 border-b border-hair px-1.5 py-1">
					<button
						type="button"
						aria-label="Bold"
						aria-pressed={editor?.isActive("bold") ?? false}
						className={`${TOOL} ${editor?.isActive("bold") ? TOOL_ON : ""}`}
						onClick={toggle(() => editor?.chain().focus().toggleBold().run())}
					>
						B
					</button>
					<button
						type="button"
						aria-label="Italic"
						aria-pressed={editor?.isActive("italic") ?? false}
						className={`${TOOL} italic ${editor?.isActive("italic") ? TOOL_ON : ""}`}
						onClick={toggle(() => editor?.chain().focus().toggleItalic().run())}
					>
						I
					</button>
					<button
						type="button"
						aria-label="Bullet list"
						aria-pressed={editor?.isActive("bulletList") ?? false}
						className={`${TOOL} ${editor?.isActive("bulletList") ? TOOL_ON : ""}`}
						onClick={toggle(() =>
							editor?.chain().focus().toggleBulletList().run(),
						)}
					>
						• List
					</button>
					<button
						type="button"
						aria-label="Numbered list"
						aria-pressed={editor?.isActive("orderedList") ?? false}
						className={`${TOOL} ${editor?.isActive("orderedList") ? TOOL_ON : ""}`}
						onClick={toggle(() =>
							editor?.chain().focus().toggleOrderedList().run(),
						)}
					>
						1. List
					</button>
				</div>
				<EditorContent
					editor={editor}
					className="[&_.ProseMirror]:min-h-24 [&_.ProseMirror]:px-[11px] [&_.ProseMirror]:py-2 [&_.ProseMirror]:text-[13px] [&_.ProseMirror]:text-fg [&_.ProseMirror]:outline-none [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5"
				/>
			</div>
			<div className="flex justify-between">
				{error ? (
					<span className="text-[11.5px] text-danger">{error}</span>
				) : (
					<span />
				)}
				{maxLength !== undefined && (
					<span className="font-mono text-[11px] text-fg-faint">
						{chars.toLocaleString()}/{maxLength.toLocaleString()}
					</span>
				)}
			</div>
			<input type="hidden" name={name} value={html} />
		</div>
	);
}
