import { MOTION_FEEDBACK } from "~/ui/motion-classes";
import {
	type ComponentType,
	type FormEventHandler,
	useRef,
	useState,
} from "react";
import {
	type FetcherFormProps,
	useFetcher,
	useRouteLoaderData,
} from "react-router";
import { parseTheme, THEMES, type Theme } from "~/lib/theme";
import { useBusy } from "~/lib/use-busy";
import { useDismiss } from "~/lib/use-dismiss";
import { Icon, PopoverSurface, type IconName } from "~/ui";
import { cn } from "~/ui/cn";
import type { loader as rootLoader } from "~/root";

/**
 * Tri-state theme switcher (System / Light / Dark). POSTs to /theme; the root
 * loader re-reads the cookie on revalidation, while root's optimistic read of
 * this fetcher flips the document instantly. Skin invariant, kept in lockstep:
 * trigger = the sidebar icon-button recipe, popover = Panel card, row = Tr's.
 */

const LABELS: Record<Theme, string> = {
	system: "System",
	light: "Light",
	dark: "Dark",
};

const ICONS: Record<Theme, IconName> = {
	system: "contrast",
	light: "sun",
	dark: "moon",
};

type ThemeMenuFormProps = {
	Form: "form" | ComponentType<FetcherFormProps>;
	busy: boolean;
	theme: Theme;
	placement?: "above" | "below";
	onSubmit: FormEventHandler<HTMLFormElement>;
};

export function ThemeMenuForm({
	Form,
	busy,
	theme,
	placement = "above",
	onSubmit,
}: ThemeMenuFormProps) {
	return (
		<PopoverSurface
			as={Form}
			method="post"
			action="/theme"
			onSubmit={onSubmit}
			side={placement === "below" ? "bottom" : "top"}
			align="end"
			width="sm"
			padding="menu"
		>
			{THEMES.map((option) => (
				<button
					key={option}
					type="submit"
					name="theme"
					value={option}
					disabled={busy}
					aria-current={option === theme || undefined}
					className={cn(
						"flex h-[34px] w-full items-center gap-[10px] px-[12px] text-left text-[13px] font-medium text-fg-muted",
						`transition-colors ${MOTION_FEEDBACK} hover:bg-row-hover hover:text-fg`,
						"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-petrol",
						option === theme &&
							"bg-row-selected text-fg shadow-[inset_2px_0_0_var(--color-petrol)]",
					)}
				>
					<span
						className={cn(
							"opacity-70",
							option === theme && "text-petrol opacity-100",
						)}
					>
						<Icon name={ICONS[option]} size={15} />
					</span>
					{LABELS[option]}
				</button>
			))}
		</PopoverSurface>
	);
}

export function ThemeToggle({
	placement = "above",
}: {
	placement?: "above" | "below";
} = {}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const fetcher = useFetcher();
	const busy = useBusy();
	const data = useRouteLoaderData<typeof rootLoader>("root");
	const theme =
		parseTheme(fetcher.formData?.get("theme")) ?? data?.theme ?? "system";

	useDismiss(rootRef, open, setOpen);

	return (
		<div ref={rootRef} className="relative">
			<button
				type="button"
				aria-label={`Theme: ${LABELS[theme]}`}
				title={`Theme: ${LABELS[theme]}`}
				aria-expanded={open}
				aria-haspopup="true"
				onClick={() => setOpen((o) => !o)}
				className={`flex h-7 w-7 items-center justify-center rounded-control text-fg-faint transition-colors ${MOTION_FEEDBACK} hover:bg-chip hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol`}
			>
				<Icon name={ICONS[theme]} size={15} />
			</button>
			{open && (
				<ThemeMenuForm
					Form={fetcher.Form}
					busy={busy}
					theme={theme}
					placement={placement}
					onSubmit={() => setOpen(false)}
				/>
			)}
		</div>
	);
}
