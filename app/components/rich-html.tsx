const PROSE = [
	"text-[13px] leading-relaxed text-fg",
	"[&_p]:my-1 [&_h1]:my-2 [&_h1]:font-display [&_h1]:text-[17px] [&_h1]:font-semibold",
	"[&_h2]:my-2 [&_h2]:font-display [&_h2]:text-[15px] [&_h2]:font-semibold",
	"[&_h3]:my-1 [&_h3]:text-[13.5px] [&_h3]:font-semibold",
	"[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5",
	"[&_a]:text-petrol [&_a]:underline [&_a]:underline-offset-2",
	"[&_blockquote]:border-l-2 [&_blockquote]:border-hair-strong [&_blockquote]:pl-3 [&_blockquote]:text-fg-muted",
	"[&_code]:font-mono [&_code]:text-[12px]",
].join(" ");

/**
 * Renders STORED rich text. Only sanitized speaker HTML (app/lib/html.ts) or
 * organizer-authored template/welcome HTML may pass through here.
 */
export function RichHtml({ html }: { html: string }) {
	return <div className={PROSE} dangerouslySetInnerHTML={{ __html: html }} />;
}
