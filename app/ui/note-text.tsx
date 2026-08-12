import type { ReactNode } from "react";

/** ErrorText's calm sibling: what an action just did, said in place. */
export function NoteText({ children }: { children: ReactNode }) {
	return <p className="w-full text-[13px] text-fg-muted">{children}</p>;
}
