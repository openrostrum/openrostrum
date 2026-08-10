import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { cn } from "~/ui/cn";

/**
 * The shared rich-text editor (Tiptap, `immediatelyRender: false` for SSR).
 * Lives here pending adoption into `app/ui` (integration-owner request filed
 * with the emails PR) — swapping it in later is an import-path change only.
 *
 * Form integration: keeps a hidden input in sync so a plain <Form method=post>
 * submits the HTML under `name` with no client JS beyond the editor itself.
 */
export function RichText({
	name,
	defaultValue,
	invalid,
	onChange,
}: {
	name: string;
	defaultValue: string;
	invalid?: boolean;
	onChange?: (html: string) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const editor = useEditor({
		extensions: [StarterKit],
		content: defaultValue,
		immediatelyRender: false,
		onUpdate({ editor: e }) {
			const next = e.getHTML();
			if (inputRef.current) inputRef.current.value = next;
			onChange?.(next);
		},
		editorProps: {
			attributes: {
				class: cn(
					"min-h-[190px] px-[11px] py-2 text-[13px] text-fg outline-none",
					"[&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-hair-strong [&_blockquote]:pl-3",
					"[&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5",
					"[&_h1]:text-[17px] [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:font-semibold",
				),
			},
		},
	});
	// Serialization-time sync: React Router builds `new FormData(form)` on
	// submit, which fires this event — reading the editor HERE means the
	// submitted HTML can never be stale, whatever the render/update timing.
	useEffect(() => {
		const form = inputRef.current?.form;
		if (!form || !editor) return;
		const sync = (event: FormDataEvent) => {
			event.formData.set(name, editor.getHTML());
		};
		form.addEventListener("formdata", sync);
		return () => form.removeEventListener("formdata", sync);
	}, [editor, name]);

	const marks = useEditorState({
		editor,
		selector: ({ editor: e }) =>
			e
				? {
						bold: e.isActive("bold"),
						italic: e.isActive("italic"),
						underline: e.isActive("underline"),
						bulletList: e.isActive("bulletList"),
						orderedList: e.isActive("orderedList"),
					}
				: null,
	});

	return (
		<div
			className={cn(
				"rounded-control bg-surface shadow-control",
				"focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-petrol",
				invalid && "shadow-[inset_0_0_0_1px_var(--color-danger)]",
			)}
		>
			<input
				ref={inputRef}
				type="hidden"
				name={name}
				defaultValue={defaultValue}
			/>
			<div className="flex gap-1 border-b border-hair px-2 py-1">
				<ToolbarButton
					label="Bold"
					active={marks?.bold}
					onClick={() => editor?.chain().focus().toggleBold().run()}
				>
					<span className="font-semibold">B</span>
				</ToolbarButton>
				<ToolbarButton
					label="Italic"
					active={marks?.italic}
					onClick={() => editor?.chain().focus().toggleItalic().run()}
				>
					<span className="italic">I</span>
				</ToolbarButton>
				<ToolbarButton
					label="Underline"
					active={marks?.underline}
					onClick={() => editor?.chain().focus().toggleUnderline().run()}
				>
					<span className="underline">U</span>
				</ToolbarButton>
				<ToolbarButton
					label="Bullet list"
					active={marks?.bulletList}
					onClick={() => editor?.chain().focus().toggleBulletList().run()}
				>
					• List
				</ToolbarButton>
				<ToolbarButton
					label="Numbered list"
					active={marks?.orderedList}
					onClick={() => editor?.chain().focus().toggleOrderedList().run()}
				>
					1. List
				</ToolbarButton>
			</div>
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
	children: React.ReactNode;
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
