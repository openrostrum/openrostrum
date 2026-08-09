import { PageHeader } from "~/ui";

// No loader yet — nothing to protect. The moment one is added it must
// self-authenticate (the layout loader is bypassable via `?_routes=`).
export default function AdminDashboard() {
	return (
		<div className="mx-auto max-w-5xl px-7 py-6">
			<PageHeader
				title="Dashboard"
				subtitle="Overview widgets land here. Use the sidebar to navigate."
			/>
		</div>
	);
}
