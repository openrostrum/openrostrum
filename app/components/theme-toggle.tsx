import {
	type ElementType,
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
import { Icon, type IconName } from "~/ui";
import { cn } from "~/ui/cn";
import type { loader as rootLoader } from "~/root";

/**
 * Tri-state theme switcher (System / Light / Dark). POSTs to /theme; the root
 * loader re-reads the cookie on revalidation, and root's optimistic read of
 * this fetcher flips the document instantly. Skin invariant: the trigger IS
 * the sidebar's icon-button recipe (logout), the popover IS Panel's card, and
 * row selection IS Tr's selected treatment — keep them in lockstep.
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
	Form: ElementType<FetcherFormProps>;
	busy: boolean;
	theme: Theme;
	onSubmit: FormEventHandler<HTMLFormElement>;
};

export function ThemeMenuForm({
	Form,
	busy,
	theme,
	onSubmit,
}: ThemeMenuFormProps) {
	return (
		<Form
			method="post"
			action="/theme"
			onSubmit={onSubmit}
			className="absolute bottom-full right-0 z-20 mb-[6px] flex w-[168px] flex-col overflow-hidden rounded-card bg-surface py-1 shadow-card"
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
						"transition-colors duration-150 hover:bg-row-hover hover:text-fg",
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
		</Form>
	);
}

export function ThemeToggle() {
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
				className="flex h-7 w-7 items-center justify-center rounded-control text-fg-faint transition-colors duration-150 hover:bg-chip hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol"
			>
				<Icon name={ICONS[theme]} size={15} />
			</button>
			{open && (
				<ThemeMenuForm
					Form={fetcher.Form}
					busy={busy}
					theme={theme}
					onSubmit={() => setOpen(false)}
				/>
			)}
		</div>
	);
}
