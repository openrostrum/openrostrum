import type { ReactNode } from "react";

/** What an action just did, said in place — not an empty state (EmptyLine). */
export function NoteText({ children }: { children: ReactNode }) {
	return <p className="w-full text-[13px] text-fg-muted">{children}</p>;
}
