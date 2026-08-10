import type { ReactNode } from "react";
import { Link } from "react-router";
import { Icon, Wordmark } from "~/ui";
import { cn } from "~/ui/cn";
import {
	COMPARE,
	type CompareCell,
	DEMO_EMAIL,
	DEMO_PASSWORD,
	DEPLOY_STEPS,
	GITHUB_URL,
	REQUIREMENTS,
	STACK,
} from "./content";
import { AdminShellMock, AgendaMock, InviteMock } from "./mocks";
import { CopyValue, Cta, Eyebrow } from "./primitives";

const SHELL = "mx-auto w-full max-w-[1120px] px-6";
const H2 =
	"font-display text-[clamp(1.6rem,3vw,2.2rem)] font-semibold leading-[1.12] tracking-[-0.015em] text-balance text-fg";
const LEAD = "max-w-[40rem] text-[15.5px] leading-relaxed text-fg-muted";
const NAV_LINK =
	"rounded text-[13.5px] font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol";

function TopNav() {
	return (
		<header className="sticky top-0 z-20 border-b border-hair bg-canvas">
			<div
				className={cn(SHELL, "flex h-16 items-center justify-between gap-4")}
			>
				<Link
					to="/"
					className="rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol"
				>
					<Wordmark />
				</Link>
				<nav className="hidden items-center gap-8 md:flex">
					<a href="#parity" className={NAV_LINK}>
						Features
					</a>
					<a href="#compare" className={NAV_LINK}>
						Compare
					</a>
					<a href="#self-host" className={NAV_LINK}>
						Self-host
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
				<Cta to="/login">Sign in</Cta>
			</div>
		</header>
	);
}

function Hero() {
	return (
		<section className={cn(SHELL, "pt-16 md:pt-24")}>
			<div className="flex max-w-[46rem] flex-col items-start gap-6">
				<Eyebrow>Conference speaker &amp; program management</Eyebrow>
				<h1 className="font-display text-[clamp(2.1rem,4.6vw,3.4rem)] font-semibold leading-[1.06] tracking-[-0.018em] text-balance text-fg">
					The open-source Sessionboard alternative.
				</h1>
				<p className="text-[16.5px] leading-relaxed text-fg-muted">
					Call for speakers, submission review, speaker portals, agenda
					building, and speaker comms — the whole program side of your
					conference, on software you host and own. MIT-licensed, free of
					per-seat anything.
				</p>
				<div className="flex flex-wrap items-center gap-3">
					<Cta to="/login">Sign in to the sandbox event</Cta>
					<Cta href="#self-host" variant="ghost">
						Deploy your own
					</Cta>
				</div>
				<div className="flex flex-col gap-2">
					<span className="text-[13px] leading-relaxed text-fg-muted">
						This site runs a real instance, seeded with a sandbox event and a
						shared organizer seat — walk in and try it:
					</span>
					<span className="flex flex-wrap items-center gap-2">
						<CopyValue value={DEMO_EMAIL} />
						<CopyValue value={DEMO_PASSWORD} />
					</span>
				</div>
			</div>
			{/* The product is the hero shot — and it stands on a petrol platform,
			    the brand mark drawn at page scale. */}
			<div className="mt-12 md:mt-16">
				<div className="starting:translate-y-3 starting:opacity-0 transition-[opacity,translate] duration-500 ease-out motion-reduce:transition-none">
					<AdminShellMock />
				</div>
				<div
					aria-hidden="true"
					className="mx-8 h-[5px] rounded-[2px] bg-petrol sm:mx-14"
				/>
			</div>
		</section>
	);
}

function Requirements() {
	return (
		<section id="parity" className="scroll-mt-16">
			<div className={cn(SHELL, "py-20 md:py-28")}>
				<div className="flex flex-col gap-4">
					<Eyebrow>Feature parity</Eyebrow>
					<h2 className={H2}>Sessionboard&rsquo;s whole job, covered.</h2>
					<p className={LEAD}>
						An event team needs six things from the program side. All six, in
						one place — from the first submission to the final schedule.
					</p>
				</div>
				<div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
					{REQUIREMENTS.map((req, index) => (
						<div
							key={req.title}
							className="flex flex-col gap-2.5 border-t border-hair pt-5"
						>
							<span className="font-mono text-[11px] font-medium tabular-nums text-fg-faint">
								0{index + 1}
							</span>
							<h3 className="text-[15px] font-semibold text-fg">{req.title}</h3>
							<p className="text-[13.5px] leading-relaxed text-fg-muted">
								{req.body}
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
				className={cn("flex flex-col items-start gap-5", flip && "lg:order-2")}
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
			<div className={cn("flex justify-center", flip && "lg:order-1")}>
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
					eyebrow="Beyond parity"
					title="Calendar invites that actually land."
					body="Sessionboard can't send a speaker a calendar invite. OpenRostrum attaches a real .ics to every acceptance and schedule change."
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
					<Eyebrow>Honestly compared</Eyebrow>
					<h2 className={H2}>Same job. Yours to keep.</h2>
					<p className={LEAD}>
						OpenRostrum covers the program side of Sessionboard — and hands you
						the source, the data, and the bill.
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

function CodeBlock() {
	return (
		<div className="overflow-hidden rounded-card border border-hair bg-surface shadow-card">
			<div className="flex items-center gap-1.5 border-b border-hair px-4 py-2.5">
				<span className="h-2.5 w-2.5 rounded-full bg-hair-strong" />
				<span className="h-2.5 w-2.5 rounded-full bg-hair-strong" />
				<span className="h-2.5 w-2.5 rounded-full bg-hair-strong" />
				<span className="ml-2 font-mono text-[11px] text-fg-faint">
					deploy your own
				</span>
			</div>
			<div className="flex flex-col gap-3.5 bg-chip p-4">
				{DEPLOY_STEPS.map((step) => (
					<div key={step.command} className="flex flex-col gap-0.5">
						<span className="font-mono text-[11px] text-fg-faint">
							# {step.comment}
						</span>
						<span className="font-mono text-[12.5px] text-fg">
							<span className="text-petrol">$ </span>
							{step.command}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function Deploy() {
	return (
		<section id="self-host" className="scroll-mt-16 border-t border-hair">
			<div className={cn(SHELL, "py-20 md:py-24")}>
				<div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
					<div className="flex flex-col items-start gap-5">
						<Eyebrow>Self-host</Eyebrow>
						<h2 className={H2}>
							Your instance. Your Cloudflare account. Four commands.
						</h2>
						<p className={LEAD}>
							Every event team runs its own instance and owns the database, the
							files, and every speaker&rsquo;s data. Nothing is hardcoded to our
							sandbox — the repo deploys clean to any Cloudflare account.
						</p>
						<div className="flex flex-wrap gap-2">
							{STACK.map((item) => (
								<span
									key={item}
									className="rounded-full border border-hair bg-surface px-3 py-1 font-mono text-[11px] text-fg-muted"
								>
									{item}
								</span>
							))}
						</div>
						<div className="flex flex-wrap gap-3 pt-2">
							<Cta href={GITHUB_URL} external>
								View on GitHub
							</Cta>
							<Cta to="/login" variant="ghost">
								Try the sandbox event
							</Cta>
						</div>
					</div>
					<CodeBlock />
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
							The open-source Sessionboard alternative for conference speaker
							and program management.
						</p>
					</div>
					<div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
						<FooterCol
							title="Product"
							links={[
								{ label: "Sandbox event", to: "/login" },
								{ label: "Sign in", to: "/login" },
							]}
						/>
						<FooterCol
							title="Open source"
							links={[
								{ label: "GitHub", href: GITHUB_URL, external: true },
								{ label: "Self-host", href: "#self-host" },
							]}
						/>
						<FooterCol
							title="Explore"
							links={[
								{ label: "Features", href: "#parity" },
								{ label: "Compare", href: "#compare" },
							]}
						/>
					</div>
				</div>
				<div className="mt-12 flex flex-col gap-3 border-t border-hair pt-6 sm:flex-row sm:items-center sm:justify-between">
					<span className="text-[12px] text-fg-faint">
						Built for Kill My SaaS 1 · MIT licensed
					</span>
					<span className="text-[12px] text-fg-faint">
						Runs on Cloudflare Workers, D1 &amp; R2
					</span>
				</div>
			</div>
		</footer>
	);
}

export function Landing() {
	// data-theme="light" pins every light-dark() token below it to the light
	// "Gallery" skin — the marketing page presents the product the way the demo
	// does, regardless of the visitor's OS theme. app.css lifts the pin to the
	// <html> element so overscroll never flashes the dark canvas.
	return (
		<div
			data-theme="light"
			style={{ colorScheme: "light" }}
			className="min-h-dvh bg-canvas text-fg"
		>
			<TopNav />
			<main>
				<Hero />
				<Requirements />
				<Spotlights />
				<Comparison />
				<Deploy />
			</main>
			<Footer />
		</div>
	);
}
