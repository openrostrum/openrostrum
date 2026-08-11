import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { MotionReveal } from "./motion";

/**
 * THE shared rich-text editor (Tiptap; B/I/U, lists, links). Every
 * WYSIWYG surface renders this one component — emails, CFP wizard, portal,
 * contacts, form builder. Sanitization stays a WRITE-boundary concern
 * (`sanitizeHtml` in app/lib/html.ts) — this component only edits.
 *
 * Form integration: with `name` set, the HTML submits through a hidden input
 * that is rewritten during the `formdata` event — React Router builds
 * `new FormData(form)` on submit, which fires that event, so the submitted
 * HTML can never be stale whatever the render/update timing. Controlled
 * consumers (the public wizard's draft state) pass `value`/`onChange` instead.
 */
export type RichTextProps = {
	/** Form field name. When set, the HTML submits through a hidden input. */
	name?: string;
	/** `<form id>` for editors rendered outside their form element. */
	form?: string;
	/** Initial content (uncontrolled). */
	defaultValue?: string;
	/** Controlled content — external changes adopt while the editor is unfocused. */
	value?: string;
	/** Fires with the current HTML ("" when visually empty). */
	onChange?: (html: string) => void;
	invalid?: boolean;
	placeholder?: string;
	/** Compact = fewer toolbar buttons (short bios). */
	compact?: boolean;
	/** Accessible name (a visual label can't reach the contenteditable). */
	ariaLabel?: string;
	/** Editing-area height: `sm` for field-sized content, `lg` for email bodies. */
	size?: "sm" | "lg";
};

function currentHtml(editor: {
	getText: () => string;
	getHTML: () => string;
}): string {
	return editor.getText().trim().length === 0 ? "" : editor.getHTML();
}

export function RichText({
	name,
	form,
	defaultValue,
	value,
	onChange,
	invalid,
	placeholder,
	compact,
	ariaLabel,
	size = "sm",
}: RichTextProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [linkOpen, setLinkOpen] = useState(false);
	const [linkUrl, setLinkUrl] = useState("");
	const editor = useEditor({
		// StarterKit ships Link + Underline; clicking a link must edit, not navigate.
		extensions: [StarterKit.configure({ link: { openOnClick: false } })],
		content: value ?? defaultValue ?? "",
		immediatelyRender: false,
		onUpdate({ editor: e }) {
			onChange?.(currentHtml(e));
		},
		editorProps: {
			attributes: {
				class: cn(
					size === "lg" ? "min-h-[190px]" : "min-h-24",
					"px-[11px] py-2 text-[13px] leading-relaxed text-fg outline-none",
					"[&_a]:text-petrol [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-hair-strong [&_blockquote]:pl-3",
					"[&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 first:[&_p]:mt-0",
					"[&_h1]:text-[17px] [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:font-semibold",
				),
				role: "textbox",
				"aria-multiline": "true",
				...(ariaLabel ? { "aria-label": ariaLabel } : {}),
			},
		},
	});

	// Serialization-time sync: React Router builds `new FormData(form)` on
	// submit, which fires this event — reading the editor HERE means the
	// submitted HTML can never be stale, whatever the render/update timing.
	useEffect(() => {
		const formEl = inputRef.current?.form;
		if (!formEl || !editor || !name) return;
		const sync = (event: FormDataEvent) => {
			event.formData.set(name, currentHtml(editor));
		};
		formEl.addEventListener("formdata", sync);
		return () => formEl.removeEventListener("formdata", sync);
	}, [editor, name]);

	// Controlled mode: adopt external value changes (draft resume) without
	// clobbering the user's cursor mid-typing.
	useEffect(() => {
		if (value === undefined || !editor || editor.isFocused) return;
		if (currentHtml(editor) !== value) {
			editor.commands.setContent(value || "", { emitUpdate: false });
		}
	}, [editor, value]);

	const state = useEditorState({
		editor,
		selector: ({ editor: e }) =>
			e
				? {
						bold: e.isActive("bold"),
						italic: e.isActive("italic"),
						underline: e.isActive("underline"),
						bulletList: e.isActive("bulletList"),
						orderedList: e.isActive("orderedList"),
						link: e.isActive("link"),
						empty: e.getText().trim().length === 0,
					}
				: null,
	});

	const applyLink = () => {
		const href = linkUrl.trim();
		if (href && editor) {
			editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
		}
		setLinkOpen(false);
		setLinkUrl("");
	};

	return (
		<div
			className={cn(
				"relative flex flex-col rounded-control bg-surface shadow-control",
				"focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-petrol",
				invalid && "shadow-[inset_0_0_0_1px_var(--color-danger)]",
			)}
		>
			{name && (
				<input
					ref={inputRef}
					type="hidden"
					name={name}
					form={form}
					defaultValue={defaultValue ?? value ?? ""}
				/>
			)}
			<div className="flex flex-wrap items-center gap-1 border-b border-hair px-2 py-1">
				<ToolbarButton
					label="Bold"
					active={state?.bold}
					onClick={() => editor?.chain().focus().toggleBold().run()}
				>
					<span className="font-semibold">B</span>
				</ToolbarButton>
				<ToolbarButton
					label="Italic"
					active={state?.italic}
					onClick={() => editor?.chain().focus().toggleItalic().run()}
				>
					<span className="italic">I</span>
				</ToolbarButton>
				<ToolbarButton
					label="Underline"
					active={state?.underline}
					onClick={() => editor?.chain().focus().toggleUnderline().run()}
				>
					<span className="underline">U</span>
				</ToolbarButton>
				<ToolbarButton
					label="Bullet list"
					active={state?.bulletList}
					onClick={() => editor?.chain().focus().toggleBulletList().run()}
				>
					• List
				</ToolbarButton>
				{!compact && (
					<ToolbarButton
						label="Numbered list"
						active={state?.orderedList}
						onClick={() => editor?.chain().focus().toggleOrderedList().run()}
					>
						1. List
					</ToolbarButton>
				)}
				{state?.link ? (
					<ToolbarButton
						label="Remove link"
						active
						onClick={() => editor?.chain().focus().unsetLink().run()}
					>
						Unlink
					</ToolbarButton>
				) : (
					<ToolbarButton
						label="Link"
						active={linkOpen}
						onClick={() => setLinkOpen((open) => !open)}
					>
						Link
					</ToolbarButton>
				)}
			</div>
			{linkOpen && !state?.link && (
				<MotionReveal>
					<div className="flex items-center gap-1 border-b border-hair px-2 py-1">
						<input
							aria-label="Link URL"
							placeholder="https://…"
							value={linkUrl}
							onChange={(e) => setLinkUrl(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									applyLink();
								}
								if (e.key === "Escape") {
									setLinkOpen(false);
									setLinkUrl("");
								}
							}}
							className={cn(
								"h-7 min-w-0 flex-1 rounded-[5px] bg-canvas px-2 text-[12px] text-fg shadow-control",
								"placeholder:text-fg-faint",
								"focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-petrol",
							)}
						/>
						<ToolbarButton label="Apply link" onClick={applyLink}>
							Apply
						</ToolbarButton>
					</div>
				</MotionReveal>
			)}
			{state?.empty && placeholder && !linkOpen && (
				<span className="pointer-events-none absolute left-[11px] top-[41px] text-[13px] text-fg-faint">
					{placeholder}
				</span>
			)}
			<EditorContent editor={editor} />
		</div>
	);
}

function ToolbarButton({
	label,
	active,
	onClick,
	children,
}: {
	label: string;
	active?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={active}
			title={label}
			onMouseDown={(e) => e.preventDefault()} // keep the editor selection
			onClick={onClick}
			className={cn(
				"h-7 min-w-7 rounded-[5px] px-2 text-[12px] font-medium text-fg-muted hover:bg-chip hover:text-fg",
				"focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-petrol",
				active && "bg-chip text-fg",
			)}
		>
			{children}
		</button>
	);
}

// Default export so code-split consumers can `lazy(() => import("~/ui/rich-text"))`.
export default RichText;
