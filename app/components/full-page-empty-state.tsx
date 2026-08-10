import type { ComponentProps, ReactNode } from "react";
import { EmptyState } from "~/ui";

export function FullPageEmptyState({
	actions,
	...emptyState
}: Omit<ComponentProps<typeof EmptyState>, "action"> & {
	actions?: ReactNode;
}) {
	return (
		<main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
			<EmptyState
				{...emptyState}
				action={
					actions ? (
						<div className="flex flex-wrap items-center justify-center gap-2">
							{actions}
						</div>
					) : undefined
				}
			/>
		</main>
	);
}
