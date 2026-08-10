import {
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useFetchers,
	useMatches,
	useRouteLoaderData,
} from "react-router";

import { describeRouteError } from "~/lib/error-page";
import { ButtonLink, EmptyState } from "~/ui";
import type { Route } from "./+types/root";
import "./app.css";
import {
	documentScheme,
	getTheme,
	parseTheme,
	type SchemePin,
	type Theme,
} from "~/lib/theme";

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

// @public — runs on every request incl. login; it only parses the theme
// cookie, no data crosses an auth boundary.
export async function loader({ request }: Route.LoaderArgs) {
	return { theme: getTheme(request) };
}

/** An in-flight theme submission, so the document flips before the cookie
 * round-trip lands (the last submission wins). */
function useOptimisticTheme(): Theme | null {
	let optimistic: Theme | null = null;
	for (const fetcher of useFetchers()) {
		if (fetcher.formAction !== "/theme") continue;
		optimistic = parseTheme(fetcher.formData?.get("theme")) ?? optimistic;
	}
	return optimistic;
}

export function Layout({ children }: { children: React.ReactNode }) {
	// Route pin (handle.colorScheme: marketing "light", embeds "os") beats the
	// visitor's cookie choice, which beats the OS default. The inline style
	// wins over the stylesheet, and app.css keeps color-scheme off <body>, so
	// every light-dark() token below inherits the pin.
	const pin = useMatches().reduce<SchemePin | null>((found, match) => {
		const declared = (match.handle as { colorScheme?: SchemePin } | undefined)
			?.colorScheme;
		return declared ?? found;
	}, null);
	const data = useRouteLoaderData<typeof loader>("root");
	const optimistic = useOptimisticTheme();
	const scheme = documentScheme(pin, optimistic ?? data?.theme ?? "system");
	return (
		<html lang="en" style={scheme ? { colorScheme: scheme } : undefined}>
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
