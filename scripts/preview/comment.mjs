export const COMMENT_MARKER = "<!-- openrostrum-pr-preview -->";

export function previewCommentBody({ url, pr, sha }) {
	const lines = [
		COMMENT_MARKER,
		`Preview for #${pr} is up at ${url}`,
		"",
		"This is a separate Worker with its own D1 and R2. Signup and admin writes stay off production.",
		"Email stays in `/admin/emails/history`. Turnstile is keyless.",
	];
	if (sha) lines.push("", `Built from \`${sha}\`.`);
	return `${lines.join("\n")}\n`;
}

export function selectPreviewComment(comments) {
	return (
		comments.find((comment) => comment.body?.includes(COMMENT_MARKER)) ?? null
	);
}
