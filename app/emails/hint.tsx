/** Small muted helper text (feature-local; no ~/ui equivalent yet). */
export function Hint({ children }: { children: React.ReactNode }) {
	return <span className="text-[12.5px] text-fg-muted">{children}</span>;
}
