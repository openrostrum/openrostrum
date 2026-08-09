// Deterministic identity colors: same name, same hue, both themes readable.
// light-dark() in the inline style keeps the pair theme-correct without dark:
// variants; the values are a fixed design-system set, not user data.
const HUES = [
	{ light: ["#0b3634", "#d9efe9"], dark: ["#9fded2", "#0b3634"] },
	{ light: ["#5b3a86", "#eee6f8"], dark: ["#cdb8ee", "#312152"] },
	{ light: ["#8a4a12", "#f9ecdd"], dark: ["#f0c795", "#4a2a0c"] },
	{ light: ["#1e4f7a", "#e1eefa"], dark: ["#a8cef0", "#123452"] },
] as const;

function hueFor(seed: string) {
	let h = 0;
	for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 997;
	return HUES[h % HUES.length] ?? HUES[0];
}

function initials(name: string) {
	const parts = name.trim().split(/\s+/);
	return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
	const hue = hueFor(name);
	return (
		<span
			className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-[0.02em]"
			style={{
				width: size,
				height: size,
				fontSize: Math.round(size * 0.38),
				background: `light-dark(${hue.light[0]}, ${hue.dark[0]})`,
				color: `light-dark(${hue.light[1]}, ${hue.dark[1]})`,
			}}
			title={name}
		>
			{initials(name)}
		</span>
	);
}

export function AvatarStack({ names }: { names: string[] }) {
	if (names.length === 0) {
		return <span className="text-fg-faint">—</span>;
	}
	return (
		<span className="inline-flex">
			{names.map((n, i) => (
				<span
					key={n}
					className={
						i === 0
							? "rounded-full shadow-[0_0_0_2px_var(--color-surface)]"
							: "-ml-[7px] rounded-full shadow-[0_0_0_2px_var(--color-surface)]"
					}
				>
					<Avatar name={n} size={22} />
				</span>
			))}
		</span>
	);
}
