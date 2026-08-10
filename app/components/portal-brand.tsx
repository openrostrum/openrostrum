/**
 * Portal header brand block. `accentColor`/logo are ORGANIZER DATA (per-portal
 * appearance config), not skin decisions — hence the sanctioned inline style,
 * mirroring Chip's data-color rule.
 */
export function PortalBrand({
	name,
	eventName,
	accentColor,
	logoUrl,
}: {
	name: string;
	eventName: string;
	accentColor: string | null;
	logoUrl: string | null;
}) {
	return (
		<div className="flex items-center gap-3">
			{logoUrl ? (
				<img
					src={logoUrl}
					alt=""
					className="h-8 w-8 rounded-[6px] object-cover"
				/>
			) : (
				<span
					aria-hidden
					className="h-8 w-1.5 rounded-full"
					style={{ backgroundColor: accentColor ?? "var(--color-petrol)" }}
				/>
			)}
			<div className="flex flex-col">
				<span className="font-display text-[16px] font-semibold leading-tight text-fg">
					{name}
				</span>
				<span className="text-[12px] text-fg-muted">{eventName}</span>
			</div>
		</div>
	);
}
