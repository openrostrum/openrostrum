/**
 * Renders stored email HTML in a sandboxed iframe: outbox bodies can embed
 * speaker-supplied merge values, so they must never execute in the admin's
 * page context (sandbox blocks scripts AND isolates the page's CSS, so the
 * preview looks like a mail client, not like the app).
 */
export function EmailPreview({ html, title }: { html: string; title: string }) {
	const doc = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:16px;font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#222;background:#fff">${html}</body></html>`;
	return (
		<iframe
			title={title}
			sandbox=""
			srcDoc={doc}
			className="h-[320px] w-full rounded-control border-0 bg-surface shadow-control"
		/>
	);
}
