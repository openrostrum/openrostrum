import { escapeHtml } from "~/lib/html";
import type { EmbedType } from "~/lib/program-types";

export type EmbedCodeOutputs = {
	shareUrl: string;
	styledHtml: string;
	basicHtml: string;
	json: string;
	xml: string;
	iCal: string;
};

type EmbedCodeInput = {
	origin: string;
	eventSlug: string;
	publicId: string;
	type: EmbedType;
};

/** Exact third-party contracts shown in Get Code — one embed id carries the
 * saved filters through every format, including the companion calendar feed. */
export function getEmbedCodeOutputs({
	origin,
	eventSlug,
	publicId,
	type,
}: EmbedCodeInput): EmbedCodeOutputs {
	const feedFamily =
		type === "speakers" || type === "gallery" ? "speakers" : "sessions";
	const feedUrl = (kind: string) => {
		const url = new URL(
			`/feeds/${encodeURIComponent(eventSlug)}/${kind}`,
			origin,
		);
		url.searchParams.set("embed", publicId);
		return url.toString();
	};
	const shareUrl = new URL(
		`/embed/${encodeURIComponent(publicId)}`,
		origin,
	).toString();
	const scriptUrl = feedUrl("widget.js");

	return {
		shareUrl,
		styledHtml: `<script src="${escapeHtml(scriptUrl)}" async></script>`,
		basicHtml: feedUrl(`${feedFamily}.html`),
		json: feedUrl(`${feedFamily}.json`),
		xml: feedUrl(`${feedFamily}.xml`),
		iCal: feedUrl("agenda.ics"),
	};
}
