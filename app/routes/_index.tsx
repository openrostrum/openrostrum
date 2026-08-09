import type { Route } from "./+types/_index";
import { ButtonLink, Wordmark } from "~/ui";

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "OpenRostrum" },
		{ name: "description", content: "Open-source Sessionboard clone." },
	];
}

export default function Home() {
	return (
		<main className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-6 py-16">
			<Wordmark
				size={28}
				tagline="Open-source conference speaker & program management."
			/>
			<ButtonLink to="/admin">Go to admin →</ButtonLink>
		</main>
	);
}
