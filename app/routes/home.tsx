import { Link } from "react-router";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "Kill My SaaS" },
		{ name: "description", content: "Open-source Sessionboard clone." },
	];
}

export default function Home() {
	return (
		<main className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-6 py-16">
			<h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
				Kill My SaaS
			</h1>
			<p className="text-zinc-500">
				Open-source conference speaker &amp; program management.
			</p>
			<Link
				to="/submissions"
				className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
			>
				View submissions →
			</Link>
		</main>
	);
}
