import { Avatar } from "~/ui";

/** Contact avatar that prefers the uploaded headshot, initials otherwise. */
export function HeadshotAvatar({
	name,
	src,
	size = 24,
}: {
	name: string;
	/** Authz'd image URL (e.g. /admin/contacts/:id/headshot?v=…), or null. */
	src: string | null;
	size?: number;
}) {
	if (!src) return <Avatar name={name} size={size} />;
	return (
		<img
			src={src}
			alt={name}
			title={name}
			width={size}
			height={size}
			className="shrink-0 rounded-full object-cover"
		/>
	);
}
