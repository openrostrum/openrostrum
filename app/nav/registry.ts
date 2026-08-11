export interface NavItem {
	label: string;
	to: string;
	section: string;
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

export function navBySection(): Array<[string, NavItem[]]> {
	const groups = new Map<string, NavItem[]>();
	for (const item of navItems) {
		const list = groups.get(item.section) ?? [];
		list.push(item);
		groups.set(item.section, list);
	}
	return [...groups];
}
