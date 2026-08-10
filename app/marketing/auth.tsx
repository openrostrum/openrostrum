import type { ReactNode } from "react";
import { Link } from "react-router";
import { ThemeToggle } from "~/components/theme-toggle";
import { TextLink, Wordmark } from "~/ui";
import { cn } from "~/ui/cn";
import { GITHUB_URL } from "./content";
import { FOCUS_RING, PLATFORM_BAR } from "./primitives";

// The auth doorway — one composition shared by /login, /signup,
// /forgot-password, and /set-password, so the four routes stay layout-only.
// The card standing on a petrol platform is the brand mark drawn at page
// scale (the O on the rostrum), the same move as the landing hero.

const TITLE_TONES = {
	default: "text-fg",
	danger: "text-danger",
} as const;

/** Header slot steering to the opposite half of the auth pair. */
export type AuthNav = {
	/** Context shown before the link on wider screens, e.g. "New to OpenRostrum?" */
	prompt: string;
	label: string;
	to: string;
};

export function AuthPage({
	title,
	subtitle,
	tone = "default",
	nav,
	children,
	below,
}: {
	title: string;
	subtitle?: ReactNode;
	tone?: keyof typeof TITLE_TONES;
	nav?: AuthNav;
	/** Card content — the form, or a short status message (`AuthNote`). */
	children: ReactNode;
	/** Quiet secondary links under the platform, e.g. "Forgot your password?" */
	below?: ReactNode;
}) {
	return (
		<div className="flex min-h-dvh flex-col">
			<header className="flex items-center justify-between gap-4 px-6 py-5 sm:px-8">
				<Link
					to="/"
					aria-label="OpenRostrum home"
					className={cn("rounded", FOCUS_RING)}
				>
					<Wordmark />
				</Link>
				{nav && (
					<p className="flex items-baseline gap-[6px] text-[13px] text-fg-muted">
						<span className="hidden sm:inline">{nav.prompt}</span>
						<TextLink to={nav.to}>{nav.label}</TextLink>
					</p>
				)}
			</header>
			<main className="flex flex-1 items-center justify-center px-6 py-10">
				<div className="flex w-full max-w-[400px] flex-col gap-7">
					<div className="flex flex-col gap-2 text-center">
						<h1
							className={cn(
								"font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.01em] text-balance",
								TITLE_TONES[tone],
							)}
						>
							{title}
						</h1>
						{subtitle && (
							<p className="text-[13.5px] leading-relaxed text-pretty text-fg-muted">
								{subtitle}
							</p>
						)}
					</div>
					<div className="flex flex-col">
						<div className="rounded-card bg-surface p-6 shadow-card sm:p-7">
							{children}
						</div>
						<div aria-hidden="true" className={cn(PLATFORM_BAR, "mx-9")} />
					</div>
					{below && (
						<div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-fg-muted">
							{below}
						</div>
					)}
				</div>
			</main>
			<footer className="flex items-center justify-center gap-[6px] px-6 pb-7 pt-4 text-[12px] text-fg-faint">
				<span>Free and open source · MIT license</span>
				<span aria-hidden="true">·</span>
				<a
					href={GITHUB_URL}
					target="_blank"
					rel="noreferrer"
					className={cn(
						"rounded text-fg-muted transition-colors duration-150 ease-out hover:text-fg",
						FOCUS_RING,
					)}
				>
					GitHub
				</a>
				<ThemeToggle />
			</footer>
		</div>
	);
}

/** Body copy inside the auth card — status and steering messages. */
export function AuthNote({ children }: { children: ReactNode }) {
	return (
		<p className="text-[13.5px] leading-relaxed text-fg-muted">{children}</p>
	);
}
