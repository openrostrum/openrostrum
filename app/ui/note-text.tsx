import type { ReactNode } from "react";

/**
 * ErrorText's calm sibling: what an action just did, said in place. Reads like
 * EmptyLine today and is deliberately not it — an empty list and a finished
 * action are different sentences and must stay free to look different.
 */
export function NoteText({ children }: { children: ReactNode }) {
	return <p className="w-full text-[13px] text-fg-muted">{children}</p>;
}
