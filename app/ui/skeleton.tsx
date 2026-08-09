// Loading holds the page's shape — skeletons, never spinners, for lists.
export function Skeleton({ width }: { width: string }) {
	return (
		<span
			className="inline-block h-[10px] animate-pulse rounded-[5px] bg-chip motion-reduce:animate-none"
			style={{ width }}
		/>
	);
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
	const widths = ["38%", "52%", "31%", "44%", "36%", "48%"];
	return (
		<div className="rounded-card bg-surface shadow-card">
			{Array.from({ length: rows }, (_, i) => (
				<div
					key={i}
					className="flex h-[46px] items-center gap-[14px] border-t border-hair px-[14px] first:border-t-0"
				>
					<Skeleton width="15px" />
					<Skeleton width="64px" />
					<Skeleton width={widths[i % widths.length] ?? "40%"} />
					<Skeleton width="70px" />
					<span className="ml-auto">
						<Skeleton width="48px" />
					</span>
				</div>
			))}
		</div>
	);
}
