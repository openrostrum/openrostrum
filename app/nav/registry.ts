/**
 * NAV REGISTRY — parallel-agent-safe. Each feature contributes ONE file,
 * `app/nav/<feature>.nav.ts`, exporting a default NavItem. The admin shell
 * auto-discovers them via `import.meta.glob` — there is NO shared nav array to
 * edit, so ~50 agents add nav entries with zero merge conflicts here. Keep
 * `*.nav.ts` files pure data (no server imports) — they're bundled client-side.
 */
export interface NavItem {
	label: string;
	to: string;
	/** Sidebar group heading, e.g. "Program", "Portals", "Configure". */
	section: string;
	/** Sort order within the section (lower first). */
	order?: number;
	/** Icon name from app/ui/icon.tsx (string, not an import — nav files stay pure data). */
	icon?: string;
}

const modules = import.meta.glob<{ default: NavItem }>("./*.nav.ts", {
	eager: true,
});

export const navItems: NavItem[] = Object.values(modules)
	.map((m) => m.default)
	.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/** Nav items grouped by section, preserving first-seen section order. */
export function navBySection(): Array<[string, NavItem[]]> {
	const groups = new Map<string, NavItem[]>();
	for (const item of navItems) {
		const list = groups.get(item.section) ?? [];
		list.push(item);
		groups.set(item.section, list);
	}
	return [...groups];
}
