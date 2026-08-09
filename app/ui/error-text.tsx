import type { ReactNode } from "react";

export function ErrorText({ children }: { children: ReactNode }) {
	return <p className="w-full text-[13px] text-danger">{children}</p>;
}
