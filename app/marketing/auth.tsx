import { MOTION_FEEDBACK } from "~/ui/motion-classes";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ThemeToggle } from "~/components/theme-toggle";
import { TextLink, Wordmark } from "~/ui";
import { cn } from "~/ui/cn";
import { GITHUB_URL } from "./content";
import { FOCUS_RING } from "./primitives";

// One composition shared by /login, /signup, /forgot-password and
// /set-password, so those four routes stay layout-only. Plainer than the
// landing hero on purpose: the plinth reads as a progress bar above a submit
// button, and licence terms are a decision made before you reach the door.

const TITLE_TONES = {
	default: "text-fg",
	danger: "text-danger",
} as const;

export type AuthNav = {
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
	children: ReactNode;
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
					<div className="rounded-card bg-surface p-6 shadow-card sm:p-7">
						{children}
					</div>
					{below && (
						<div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-fg-muted">
							{below}
						</div>
					)}
				</div>
			</main>
			<footer className="flex items-center justify-center gap-[6px] px-6 pb-7 pt-4 text-[12px] text-fg-faint">
				<a
					href={GITHUB_URL}
					target="_blank"
					rel="noreferrer"
					className={cn(
						`rounded text-fg-muted transition-colors ${MOTION_FEEDBACK} hover:text-fg`,
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

export function AuthNote({ children }: { children: ReactNode }) {
	return (
		<p className="text-[13.5px] leading-relaxed text-fg-muted">{children}</p>
	);
}
