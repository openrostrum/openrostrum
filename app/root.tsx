import {
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useMatches,
} from "react-router";

import { describeRouteError } from "~/lib/error-page";
import { ButtonLink, EmptyState } from "~/ui";
import type { Route } from "./+types/root";
import "./app.css";

// Fonts are self-hosted (open-source product — no CDN); @font-face lives in
// app.css, preloads here cover the two faces on every first paint.
export const links: Route.LinksFunction = () => [
	{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
	{ rel: "icon", href: "/favicon.ico", sizes: "48x48" },
	{ rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
	{
		rel: "preload",
		href: "/fonts/plex-sans-400.woff2",
		as: "font",
		type: "font/woff2",
		crossOrigin: "anonymous",
	},
	{
		rel: "preload",
		href: "/fonts/plex-sans-500.woff2",
		as: "font",
		type: "font/woff2",
		crossOrigin: "anonymous",
	},
	{
		rel: "preload",
		href: "/fonts/bricolage-600.woff2",
		as: "font",
		type: "font/woff2",
		crossOrigin: "anonymous",
	},
];

export function Layout({ children }: { children: React.ReactNode }) {
	// A route can pin the document's color scheme via its handle (the marketing
	// landing pins "light"). Inline style wins over the stylesheet's
	// `color-scheme: light dark`, so every light-dark() token follows the pin.
	const pinned = useMatches().some(
		(match) =>
			(match.handle as { colorScheme?: string } | undefined)?.colorScheme ===
			"light",
	);
	return (
		<html lang="en" style={pinned ? { colorScheme: "light" } : undefined}>
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta property="og:site_name" content="OpenRostrum" />
				<meta property="og:type" content="website" />
				<meta
					property="og:description"
					content="The open-source Sessionboard alternative — CFP forms, submission review, speaker portals, agenda building."
				/>
				<meta property="og:image" content="https://openrostrum.com/og.png" />
				<meta name="twitter:card" content="summary_large_image" />
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	// import.meta.env.DEV is a build-time flag: false in every deployed bundle,
	// so the diagnostic detail below can only ever render on a dev server.
	const { title, body, detail } = describeRouteError(
		error,
		import.meta.env.DEV,
	);
	return (
		<main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 px-6 py-16">
			<EmptyState
				icon="grid"
				title={title}
				body={body}
				action={
					<ButtonLink to="/" variant="ghost">
						Go to homepage
					</ButtonLink>
				}
			/>
			{detail && (
				<pre className="overflow-x-auto rounded-card bg-surface p-4 text-[12px] leading-relaxed text-fg-muted shadow-card">
					<code>{detail}</code>
				</pre>
			)}
		</main>
	);
}
