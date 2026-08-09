import { PageHeader } from "~/ui";

export default function Forbidden() {
	return (
		<main className="mx-auto flex max-w-md flex-col items-center px-6 py-16">
			<PageHeader title="403" subtitle="You do not have access to this page." />
		</main>
	);
}
