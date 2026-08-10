import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type ReactNode, useEffect } from "react";
import { cn } from "~/ui/cn";
import type { RichTextProps } from "./ui";

/**
 * The shared rich-text editor for the public wizard (descriptions, bios,
 * wysiwyg library fields). Loaded lazily via app/cfp/ui.tsx — never import
 * this module directly from a route.
 */

function ToolbarButton({
	label,
	active,
	onClick,
	children,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={active}
			// Prevent the editor from losing focus/selection on toolbar clicks.
			onMouseDown={(e) => e.preventDefault()}
			onClick={onClick}
			className={cn(
				"flex h-7 min-w-7 items-center justify-center rounded-[5px] px-[6px] text-[12.5px] font-medium",
				"focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-petrol",
				active
					? "bg-chip text-fg"
					: "text-fg-muted hover:bg-chip hover:text-fg",
			)}
		>
			{children}
		</button>
	);
}

export default function RichTextEditor({
	value,
	onChange,
	placeholder,
	invalid,
	compact,
	ariaLabel,
}: RichTextProps) {
	const editor = useEditor({
		extensions: [StarterKit],
		content: value,
		immediatelyRender: false,
		editorProps: {
			attributes: {
				class: cn(
					"min-h-[96px] px-[11px] py-2 text-[13px] leading-relaxed text-fg outline-none",
					"[&_a]:text-petrol [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
					"[&_p]:my-1 first:[&_p]:mt-0",
				),
				...(ariaLabel ? { "aria-label": ariaLabel } : {}),
				role: "textbox",
				"aria-multiline": "true",
			},
		},
		onUpdate({ editor: e }) {
			onChange(e.getText().trim().length === 0 ? "" : e.getHTML());
		},
	});

	// Adopt external value changes (draft resume) without clobbering the
	// user's cursor mid-typing.
	useEffect(() => {
		if (!editor || editor.isFocused) return;
		const current = editor.getText().trim() === "" ? "" : editor.getHTML();
		if (current !== value) {
			editor.commands.setContent(value || "", { emitUpdate: false });
		}
	}, [editor, value]);

	if (!editor) return null;

	const empty = editor.getText().trim().length === 0;

	return (
		<div
			className={cn(
				"relative flex flex-col rounded-control bg-surface shadow-control",
				"focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-petrol",
				invalid && "shadow-[inset_0_0_0_1px_var(--color-danger)]",
			)}
		>
			<div className="flex items-center gap-[2px] border-b border-hair px-2 py-1">
				<ToolbarButton
					label="Bold"
					active={editor.isActive("bold")}
					onClick={() => editor.chain().focus().toggleBold().run()}
				>
					<span className="font-semibold">B</span>
				</ToolbarButton>
				<ToolbarButton
					label="Italic"
					active={editor.isActive("italic")}
					onClick={() => editor.chain().focus().toggleItalic().run()}
				>
					<span className="italic">I</span>
				</ToolbarButton>
				<ToolbarButton
					label="Underline"
					active={editor.isActive("underline")}
					onClick={() => editor.chain().focus().toggleUnderline().run()}
				>
					<span className="underline">U</span>
				</ToolbarButton>
				<ToolbarButton
					label="Bullet list"
					active={editor.isActive("bulletList")}
					onClick={() => editor.chain().focus().toggleBulletList().run()}
				>
					•≡
				</ToolbarButton>
				{!compact && (
					<ToolbarButton
						label="Numbered list"
						active={editor.isActive("orderedList")}
						onClick={() => editor.chain().focus().toggleOrderedList().run()}
					>
						1≡
					</ToolbarButton>
				)}
			</div>
			{empty && placeholder && (
				<span className="pointer-events-none absolute left-[11px] top-[41px] text-[13px] text-fg-faint">
					{placeholder}
				</span>
			)}
			<EditorContent editor={editor} />
		</div>
	);
}
