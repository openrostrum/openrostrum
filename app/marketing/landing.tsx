import type { ReactNode } from "react";
import { Link } from "react-router";
import { Icon, Wordmark } from "~/ui";
import { cn } from "~/ui/cn";
import {
	COMPARE,
	type CompareCell,
	DEPLOY_GUIDE_URL,
	GITHUB_URL,
	ISSUES_URL,
	JOBS,
	PUBLIC_PAGES,
} from "./content";
import { AdminShellMock, AgendaMock, InviteMock } from "./mocks";
import { Cta, Eyebrow, FOCUS_RING, PLATFORM_BAR } from "./primitives";

const SHELL = "mx-auto w-full max-w-[1120px] px-6";
const H2 =
	"font-display text-[clamp(1.6rem,3vw,2.2rem)] font-semibold leading-[1.12] tracking-[-0.015em] text-balance text-fg";
const LEAD = "max-w-[40rem] text-[15.5px] leading-relaxed text-fg-muted";
const NAV_LINK = cn(
	"rounded text-[13.5px] font-medium text-fg-muted transition-colors hover:text-fg",
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
				<nav className="hidden items-center gap-8 md:flex">
					<a href="#features" className={NAV_LINK}>
						Features
					</a>
					<a href="#compare" className={NAV_LINK}>
						Compare
					</a>
					<a href="#open-source" className={NAV_LINK}>
						Open source
					</a>
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

function Hero() {
	return (
		<section className={cn(SHELL, "pt-16 md:pt-24")}>
			<div className="flex max-w-[46rem] flex-col items-start gap-6">
				<Eyebrow>
					Conference speaker, submission &amp; program management
				</Eyebrow>
				<h1 className="font-display text-[clamp(2.1rem,4.6vw,3.4rem)] font-semibold leading-[1.06] tracking-[-0.018em] text-balance text-fg">
					The open-source Sessionboard alternative.
				</h1>
				<p className="text-[16.5px] leading-relaxed text-fg-muted">
					Manage speaker relationships, collect and review proposals, coordinate
					every presenter, and publish the program everywhere — all in one
					place. Free and open source: create your organization here, or run it
					on your own infrastructure.
				</p>
				<div className="flex flex-wrap items-center gap-3">
					<Cta to="/signup">Create your event</Cta>
					<Cta to="/schedule" variant="ghost">
						See a live schedule
					</Cta>
				</div>
			</div>
			{/* The product is the hero shot — and it stands on a petrol platform,
			    the brand mark drawn at page scale. */}
			<div className="mt-12 md:mt-16">
				<div className="starting:translate-y-3 starting:opacity-0 transition-[opacity,translate] duration-500 ease-out motion-reduce:transition-none">
					<AdminShellMock />
				</div>
				<div aria-hidden="true" className={cn(PLATFORM_BAR, "mx-8 sm:mx-14")} />
			</div>
		</section>
	);
}

function Jobs() {
	return (
		<section id="features" className="scroll-mt-16">
			<div className={cn(SHELL, "py-20 md:py-28")}>
				<div className="flex flex-col gap-4">
					<Eyebrow>What it does</Eyebrow>
					<h2 className={H2}>From first contact to published program.</h2>
					<p className={LEAD}>
						Build a speaker pipeline, open the call, review with your team, keep
						every presenter moving, and publish the program — without stitching
						together a CRM, spreadsheet, inbox, and separate publishing
						workflow.
					</p>
				</div>
				<div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
					{JOBS.map((job, index) => (
						<div
							key={job.title}
							className="flex flex-col gap-2.5 border-t border-hair pt-5"
						>
							<span className="font-mono text-[11px] font-medium tabular-nums text-fg-faint">
								0{index + 1}
							</span>
							<h3 className="text-[15px] font-semibold text-fg">{job.title}</h3>
							<p className="text-[13.5px] leading-relaxed text-fg-muted">
								{job.body}
							</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

function Bullet({ children }: { children: ReactNode }) {
	return (
		<li className="flex items-start gap-2.5 text-[14px] leading-relaxed text-fg-muted">
			<span className="mt-1 text-petrol">
				<Icon name="star" size={14} />
			</span>
			<span>{children}</span>
		</li>
	);
}

function Spotlight({
	eyebrow,
	title,
	body,
	points,
	flip,
	children,
}: {
	eyebrow: string;
	title: string;
	body: string;
	points: string[];
	flip?: boolean;
	children: ReactNode;
}) {
	return (
		<div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
			<div
				className={cn(
					"flex min-w-0 flex-col items-start gap-5",
					flip && "lg:order-2",
				)}
			>
				<Eyebrow>{eyebrow}</Eyebrow>
				<h2 className={H2}>{title}</h2>
				<p className={LEAD}>{body}</p>
				<ul className="flex flex-col gap-2.5">
					{points.map((point) => (
						<Bullet key={point}>{point}</Bullet>
					))}
				</ul>
			</div>
			<div className={cn("flex min-w-0 justify-center", flip && "lg:order-1")}>
				{children}
			</div>
		</div>
	);
}

function Spotlights() {
	return (
		<section className="border-t border-hair">
			<div
				className={cn(SHELL, "flex flex-col gap-20 py-20 md:gap-28 md:py-24")}
			>
				<Spotlight
					eyebrow="Speaker comms"
					title="Calendar invites that actually land."
					body="Every acceptance and schedule change goes out with a real .ics attached — one tap and the session is on the speaker's calendar, correctly, in their timezone."
					points={[
						"One stable calendar entry per session — updates move it in place instead of duplicating it.",
						"A day of drag-and-drop batches into one send per speaker, never fifteen.",
						"Works in Gmail, Outlook, and Apple Calendar out of the box.",
					]}
				>
					<InviteMock />
				</Spotlight>
				<Spotlight
					eyebrow="Agenda"
					title="Drag the schedule into place."
					body="Accepted sessions land in an unscheduled tray. Drop them onto a day × room grid and conflicts surface the moment they happen — no spinners between drags."
					points={[
						"Catches double-booked speakers and rooms before attendees notice.",
						"Auto-place fills open slots without a single collision.",
						"Publish once and the public agenda updates live.",
					]}
					flip
				>
					<AgendaMock />
				</Spotlight>
			</div>
		</section>
	);
}

function PublicPages() {
	return (
		<section id="public-pages" className="scroll-mt-16 border-t border-hair">
			<div className={cn(SHELL, "py-20 md:py-24")}>
				<div className="flex flex-col gap-4">
					<Eyebrow>Public pages</Eyebrow>
					<h2 className={H2}>The pages your attendees see, published live.</h2>
					<p className={LEAD}>
						Schedule, speakers, sessions, gallery, and itinerary render straight
						from approved content — no export step or stale event site. Place
						them anywhere with styled embeds, or use filtered HTML, JSON, and
						XML feeds. The published agenda also has iCal. These are the live
						pages of an event running on this site:
					</p>
				</div>
				<div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{PUBLIC_PAGES.map((page) => (
						<Link
							key={page.to}
							to={page.to}
							className={cn(
								"group flex flex-col gap-1.5 rounded-card border border-hair bg-surface p-5 shadow-card transition-colors duration-150 ease-out hover:bg-chip",
								FOCUS_RING,
							)}
						>
							<span className="flex items-center gap-2 text-[15px] font-semibold text-fg">
								{page.label}
								<span
									aria-hidden="true"
									className="text-fg-faint transition-colors group-hover:text-petrol"
								>
									→
								</span>
							</span>
							<span className="text-[13px] leading-relaxed text-fg-muted">
								{page.description}
							</span>
						</Link>
					))}
				</div>
			</div>
		</section>
	);
}

function Cell({ cell }: { cell: CompareCell }) {
	if ("text" in cell) {
		return (
			<span className="text-[13.5px] font-medium text-fg">{cell.text}</span>
		);
	}
	if (cell.yes) {
		return (
			<span className="text-petrol" aria-label="yes">
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					aria-hidden="true"
				>
					<path
						d="M5 12.5l4.5 4.5L19 7"
						stroke="currentColor"
						strokeWidth="2.2"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</span>
		);
	}
	return (
		<span className="text-[15px] text-fg-faint" aria-label="no">
			—
		</span>
	);
}

function Comparison() {
	return (
		<section id="compare" className="scroll-mt-16 border-t border-hair">
			<div className={cn(SHELL, "py-20 md:py-24")}>
				<div className="flex flex-col gap-4">
					<Eyebrow>Compared with Sessionboard</Eyebrow>
					<h2 className={H2}>Same job. Yours to keep.</h2>
					<p className={LEAD}>
						OpenRostrum covers the program side Sessionboard is sold for — with
						the source open and the data in your hands.
					</p>
				</div>
				<div className="mt-10 overflow-hidden rounded-card border border-hair">
					<div className="grid grid-cols-[1.6fr_1fr_1fr] border-b border-hair bg-thead">
						<span className="px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-fg-faint">
							Capability
						</span>
						<span className="bg-petrol-wash px-4 py-3 text-center font-display text-[13.5px] font-semibold text-petrol">
							OpenRostrum
						</span>
						<span className="px-4 py-3 text-center text-[13.5px] font-medium text-fg-muted">
							Sessionboard
						</span>
					</div>
					<div className="divide-y divide-hair">
						{COMPARE.map((row) => (
							<div
								key={row.label}
								className="grid grid-cols-[1.6fr_1fr_1fr] items-center"
							>
								<span className="px-4 py-3.5 text-[13.5px] text-fg">
									{row.label}
								</span>
								<span className="flex justify-center bg-petrol-wash px-4 py-3.5">
									<Cell cell={row.ours} />
								</span>
								<span className="flex justify-center px-4 py-3.5">
									<Cell cell={row.theirs} />
								</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}

// Risk-reversal before the closing ask. Claims stay literal enough to
// survive the click-through ("your own Cloudflare account", "public on
// GitHub"); self-hosting is the escape hatch, never a second product; and
// ink-primary is reserved page-wide for /signup, so off-site CTAs stay ghost.
function OpenSource() {
	return (
		<section id="open-source" className="scroll-mt-16 border-t border-hair">
			<div className={cn(SHELL, "py-20 md:py-24")}>
				<div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
					<div className="flex flex-col items-start gap-5">
						<Eyebrow>Open source</Eyebrow>
						<h2 className={H2}>Own the software your event runs on.</h2>
						<p className={LEAD}>
							OpenRostrum is MIT-licensed, and the full source and history are
							public on GitHub. If you ever want out of the hosted app, take
							everything with you: deploy to your own Cloudflare account and
							hold the database, the files, and every speaker record yourself.
						</p>
						<div className="flex flex-wrap gap-3 pt-2">
							<Cta href={GITHUB_URL} variant="ghost" external>
								View on GitHub
							</Cta>
							<Cta href={DEPLOY_GUIDE_URL} variant="ghost" external>
								Self-hosting guide
							</Cta>
						</div>
					</div>
					<ul className="flex flex-col gap-4 rounded-card border border-hair bg-surface p-6 shadow-card sm:p-8">
						<Bullet>
							One codebase, no gated edition — every feature ships to hosted and
							self-hosted alike, with no paid tier to unlock.
						</Bullet>
						<Bullet>
							Your data leaves whenever you want it to: CSV exports, a .zip of
							every uploaded file, and JSON, XML, and iCal feeds.
						</Bullet>
						<Bullet>
							MIT license — you never lose access to the tool your event depends
							on, even if we disappear tomorrow.
						</Bullet>
					</ul>
				</div>
			</div>
		</section>
	);
}

function ClosingCta() {
	return (
		<section className="border-t border-hair">
			<div
				className={cn(
					SHELL,
					"flex flex-col items-start gap-6 py-20 md:items-center md:py-24 md:text-center",
				)}
			>
				<h2 className={H2}>Run your next event on OpenRostrum.</h2>
				<p className={LEAD}>
					Create your organization and first event, then take the program from
					speaker pipeline to published schedule.
				</p>
				<div className="flex flex-wrap items-center gap-3 md:justify-center">
					<Cta to="/signup">Create your event</Cta>
					<Cta to="/schedule" variant="ghost">
						See a live schedule
					</Cta>
				</div>
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
			<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
				{title}
			</span>
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
			<div className={cn(SHELL, "py-14")}>
				<div className="flex flex-col gap-10 md:flex-row md:justify-between">
					<div className="flex max-w-[320px] flex-col gap-3">
						<Wordmark />
						<p className="text-[13px] leading-relaxed text-fg-muted">
							The open-source Sessionboard alternative for speaker
							relationships, submission review, and conference program
							management.
						</p>
					</div>
					{/* No "Live event" column here: footer links describe the product,
					    not one demo event's public pages — those are all reachable from
					    the "Public pages" section above (and /schedule from both CTAs). */}
					<div className="grid grid-cols-2 gap-10">
						<FooterCol
							title="Product"
							links={[
								{ label: "Get started", to: "/signup" },
								{ label: "Sign in", to: "/login" },
								{ label: "Features", href: "#features" },
								{ label: "Compare", href: "#compare" },
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
				<div className="mt-12 flex flex-col gap-3 border-t border-hair pt-6 sm:flex-row sm:items-center sm:justify-between">
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
				<Hero />
				<Jobs />
				<Spotlights />
				<PublicPages />
				<Comparison />
				<OpenSource />
				<ClosingCta />
			</main>
			<Footer />
		</div>
	);
}
