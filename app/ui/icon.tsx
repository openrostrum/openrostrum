// One icon set, one stroke weight (1.7, round caps) — mixed icon libraries
// read as two different products. Filled glyphs (sort, dots) override per path.
const PATHS = {
	grid: (
		<>
			<rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
			<rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
			<rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
			<rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
		</>
	),
	inbox: (
		<>
			<rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
			<path d="M3.5 13.5h5l1.8 2.5h3.4l1.8-2.5h5" />
		</>
	),
	mic: (
		<>
			<rect x="9.2" y="3.5" width="5.6" height="10.5" rx="2.8" />
			<path d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3" />
		</>
	),
	calendar: (
		<>
			<rect x="4" y="5.5" width="16" height="14.5" rx="2.2" />
			<path d="M4 10.2h16M8.5 3.5v3.5M15.5 3.5v3.5" />
		</>
	),
	star: (
		<path d="M12 4.4l2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.4-4.6 2.4.9-5.2-3.8-3.7 5.2-.8z" />
	),
	mail: (
		<>
			<rect x="3.5" y="5.5" width="17" height="13" rx="2.2" />
			<path d="M4.5 7.5l7.5 5.5 7.5-5.5" />
		</>
	),
	sliders: (
		<>
			<path d="M4.5 8h15M4.5 16h15" />
			<circle cx="9.5" cy="8" r="2.2" />
			<circle cx="14.5" cy="16" r="2.2" />
		</>
	),
	search: (
		<>
			<circle cx="11" cy="11" r="6.2" />
			<path d="M15.6 15.6L20 20" />
		</>
	),
	filter: <path d="M4.5 6.5h15M7.5 12h9M10.5 17.5h3" />,
	export: <path d="M12 4.5v9.5M8.2 10.6l3.8 3.9 3.8-3.9M5 19.5h14" />,
	"chevron-down": <path d="M8.5 10.2l3.5 3.6 3.5-3.6" />,
	plus: <path d="M12 5.5v13M5.5 12h13" />,
	logout: (
		<>
			<path d="M9 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h3" />
			<path d="M15.5 15.5L19 12l-3.5-3.5M19 12H9.5" />
		</>
	),
	sort: (
		<path
			d="M12 7.5l3.4 4.2h-6.8zM12 16.5l-3.4-4.2h6.8z"
			fill="currentColor"
			stroke="none"
		/>
	),
	dots: (
		<>
			<circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
			<circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
			<circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
		</>
	),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.7}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className="shrink-0"
		>
			{PATHS[name]}
		</svg>
	);
}
