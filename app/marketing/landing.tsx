import { MOTION_FEEDBACK } from "~/ui/motion-classes";
import { Link } from "react-router";
import { Caps, Wordmark } from "~/ui";
import { cn } from "~/ui/cn";
import {
	DEPLOY_GUIDE_URL,
	GITHUB_URL,
	ISSUES_URL,
	OURS,
	PUBLIC_PAGES,
	THEIRS,
} from "./content";
import { AdminShellMock, AgendaMock, InviteMock } from "./mocks";
import { Cta, FOCUS_RING, PLATFORM_BAR } from "./primitives";

const SHELL = "mx-auto w-full max-w-[1180px] px-5 sm:px-6";
const NAV_LINK = cn(
	`rounded text-[13.5px] font-medium text-fg-muted transition-colors ${MOTION_FEEDBACK} hover:text-fg`,
	FOCUS_RING,
);

function TopNav() {
	return (
		<header className="sticky top-0 z-20 border-b border-hair bg-canvas">
			<div
				className={cn(SHELL, "flex h-16 items-center justify-between gap-4")}
			>
				<Link to="/" className={cn("rounded", FOCUS_RING)}>
					<Wordmark />
				</Link>
				<nav className="hidden items-center gap-7 md:flex">
					<Link to="/schedule" className={NAV_LINK}>
						Schedule
					</Link>
					<Link to="/speakers" className={NAV_LINK}>
						Speakers
					</Link>
					<Link to="/cfp" className={NAV_LINK}>
						Call for speakers
					</Link>
					<a
						href={GITHUB_URL}
						target="_blank"
						rel="noreferrer"
						className={NAV_LINK}
					>
						GitHub
					</a>
				</nav>
				<div className="flex items-center gap-2.5">
					<span className="hidden sm:contents">
						<Cta to="/login" variant="ghost" size="sm">
							Sign in
						</Cta>
					</span>
					<Cta to="/signup" size="sm">
						Get started
					</Cta>
				</div>
			</div>
		</header>
	);
}

function Desk() {
	return (
		<section className={cn(SHELL, "pt-8 md:pt-10")}>
			<div className="rounded-shell bg-chip p-3 md:p-4">
				<div className="flex flex-col gap-5 px-2 pb-4 pt-3 sm:px-3 md:flex-row md:items-end md:justify-between md:pb-5">
					<div className="flex flex-col gap-2">
						<span className="font-mono text-[11px] font-medium tabular-nums text-fg-muted">
							Oct 12 · open source
						</span>
						<h1 className="font-display text-[clamp(2rem,4.4vw,3.15rem)] font-semibold leading-[1.04] tracking-[-0.02em] text-fg">
							Northbound AI Summit
						</h1>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<Cta to="/signup">Create your event</Cta>
						<Cta to="/schedule" variant="ghost">
							See a live schedule
						</Cta>
					</div>
				</div>
				<div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.85fr)]">
					<AdminShellMock />
					<div className="flex min-w-0 flex-col gap-3">
						<AgendaMock />
						<InviteMock />
					</div>
				</div>
			</div>
			<div aria-hidden="true" className={cn(PLATFORM_BAR, "mx-8 sm:mx-16")} />
		</section>
	);
}

function Program() {
	return (
		<section className={cn(SHELL, "py-10 md:py-12")}>
			<div className="flex flex-col gap-4 border-t border-hair pt-8 sm:flex-row sm:items-baseline sm:gap-8">
				<Caps tone="faint">Live program</Caps>
				<nav className="flex flex-wrap gap-x-6 gap-y-3">
					{PUBLIC_PAGES.map((page) => (
						<Link key={page.to} to={page.to} className={NAV_LINK}>
							{page.label}
						</Link>
					))}
				</nav>
			</div>
		</section>
	);
}

function Facts() {
	return (
		<section className={cn(SHELL, "pb-16 md:pb-20")}>
			<div className="grid gap-8 border-t border-hair pt-8 sm:grid-cols-2 sm:gap-12">
				<div className="flex flex-col gap-2.5">
					<Caps>OpenRostrum</Caps>
					<p className="text-[14px] leading-relaxed text-fg">{OURS}</p>
				</div>
				<div className="flex flex-col gap-2.5">
					<Caps tone="faint">Sessionboard</Caps>
					<p className="text-[14px] leading-relaxed text-fg-muted">{THEIRS}</p>
				</div>
			</div>
			<div className="mt-8 flex flex-wrap gap-3">
				<Cta href={GITHUB_URL} variant="ghost" external>
					View on GitHub
				</Cta>
				<Cta href={DEPLOY_GUIDE_URL} variant="ghost" external>
					Self-hosting guide
				</Cta>
			</div>
		</section>
	);
}

function FooterCol({
	title,
	links,
}: {
	title: string;
	links: { label: string; to?: string; href?: string; external?: boolean }[];
}) {
	return (
		<div className="flex flex-col gap-3">
			<Caps tone="faint">{title}</Caps>
			{links.map((link) =>
				link.to ? (
					<Link key={link.label} to={link.to} className={NAV_LINK}>
						{link.label}
					</Link>
				) : (
					<a
						key={link.label}
						href={link.href}
						className={NAV_LINK}
						{...(link.external ? { target: "_blank", rel: "noreferrer" } : {})}
					>
						{link.label}
					</a>
				),
			)}
		</div>
	);
}

function Footer() {
	return (
		<footer className="border-t border-hair">
			<div className={cn(SHELL, "py-12")}>
				<div className="flex flex-col gap-10 md:flex-row md:justify-between">
					<div className="flex max-w-[280px] flex-col gap-3">
						<Wordmark />
						<p className="text-[13px] leading-relaxed text-fg-muted">
							The open-source Sessionboard alternative.
						</p>
					</div>
					<div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
						<FooterCol
							title="Live"
							links={PUBLIC_PAGES.map((page) => ({
								label: page.label,
								to: page.to,
							}))}
						/>
						<FooterCol
							title="Product"
							links={[
								{ label: "Get started", to: "/signup" },
								{ label: "Sign in", to: "/login" },
							]}
						/>
						<FooterCol
							title="Open source"
							links={[
								{ label: "GitHub", href: GITHUB_URL, external: true },
								{
									label: "Self-hosting guide",
									href: DEPLOY_GUIDE_URL,
									external: true,
								},
								{ label: "Report an issue", href: ISSUES_URL, external: true },
							]}
						/>
					</div>
				</div>
				<div className="mt-10 flex flex-col gap-3 border-t border-hair pt-6 sm:flex-row sm:items-center sm:justify-between">
					<span className="text-[12px] text-fg-faint">
						Free and open source · MIT license
					</span>
					<span className="text-[12px] text-fg-faint">OpenRostrum</span>
				</div>
			</div>
		</footer>
	);
}

export function Landing() {
	// The route handle (_index.tsx) pins color-scheme: light on <html>, and
	// app.css keeps color-scheme off <body>, so every light-dark() token down
	// to the overscroll canvas inherits the canonical light "Gallery" skin —
	// no per-element pin needed here.
	return (
		<div className="min-h-dvh bg-canvas text-fg">
			<TopNav />
			<main>
				<Desk />
				<Program />
				<Facts />
			</main>
			<Footer />
		</div>
	);
}
