import type { ReactNode } from "react";

export function Panel({ children }: { children: ReactNode }) {
	return (
		<div className="rounded-card bg-surface p-4 shadow-card">{children}</div>
	);
}
