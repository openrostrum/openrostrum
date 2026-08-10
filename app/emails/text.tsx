/** Feature-local text atoms — ~/ui has no equivalents, so the visual
 * decisions live here in exactly one place. */

export const LABEL_CLASS =
	"text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted";

export function PanelHeading({ children }: { children: React.ReactNode }) {
	return <h2 className={LABEL_CLASS}>{children}</h2>;
}

export function Hint({ children }: { children: React.ReactNode }) {
	return <span className="text-[12.5px] text-fg-muted">{children}</span>;
}
