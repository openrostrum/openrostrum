import type { ReactNode } from "react";
import { Form, NavLink } from "react-router";
import { Avatar } from "./avatar";
import { cn } from "./cn";
import { Icon, type IconName } from "./icon";

export function Mark({ size = 24 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			aria-hidden="true"
			className="shrink-0"
		>
			<path
				fillRule="evenodd"
				d="M19.6 10.2A7.6 7.6 0 1 1 4.4 10.2A7.6 7.6 0 1 1 19.6 10.2ZM16 10.2A4 4 0 1 0 8 10.2A4 4 0 1 0 16 10.2Z"
				fill="currentColor"
			/>
			<path d="M5.5 17.8H18.5V20.8H5.5Z" className="fill-petrol" />
		</svg>
	);
}

export function Wordmark({
	size = 17,
	tagline,
}: {
	size?: number;
	tagline?: string;
}) {
	return (
		<span className="flex items-center gap-[9px] text-fg">
			<Mark size={Math.round(size * 1.4)} />
			<span className="flex flex-col gap-1">
				<span
					className="font-display font-semibold tracking-[-0.005em] text-fg"
					style={{ fontSize: size }}
				>
					<span className="text-petrol">Open</span>Rostrum
				</span>
				{tagline && (
					<span className="text-[15px] text-fg-muted">{tagline}</span>
				)}
			</span>
		</span>
	);
}

export function Sidebar({
	user,
	children,
}: {
	user: { name: string | null; email: string };
	children: ReactNode;
}) {
	return (
		<aside className="flex w-[240px] shrink-0 flex-col overflow-y-auto border-r border-hair px-3 pb-[14px] pt-[18px]">
			<div className="px-[10px]">
				<Wordmark />
			</div>
			<nav className="mt-4 flex-1">{children}</nav>
			<div className="mt-auto flex items-center gap-[10px] border-t border-hair px-[10px] pt-3">
				<Avatar name={user.name ?? user.email} size={26} />
				<div className="min-w-0 flex-1">
					<div className="truncate text-[13px] font-medium leading-[1.3] text-fg">
						{user.name ?? user.email}
					</div>
					<div className="truncate text-[11.5px] text-fg-faint">
						{user.email}
					</div>
				</div>
				<Form method="post" action="/logout">
					<button
						type="submit"
						aria-label="Log out"
						className="flex h-7 w-7 items-center justify-center rounded-control text-fg-faint transition-colors duration-150 hover:bg-chip hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol"
					>
						<Icon name="logout" size={15} />
					</button>
				</Form>
			</div>
		</aside>
	);
}

export function SidebarSection({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div>
			<div className="mb-[5px] mt-4 px-[10px] text-[10.5px] font-semibold uppercase tracking-[0.09em] text-fg-faint">
				{label}
			</div>
			{children}
		</div>
	);
}

export function SideNavLink({
	to,
	icon,
	children,
}: {
	to: string;
	icon?: IconName;
	children: ReactNode;
}) {
	return (
		<NavLink
			to={to}
			end
			className={({ isActive }) =>
				cn(
					"flex h-[34px] items-center gap-[10px] rounded-control px-[10px] text-[13.5px] font-medium text-fg-muted",
					"transition-colors duration-150 hover:bg-row-hover hover:text-fg",
					"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol",
					isActive && "bg-chip text-fg",
				)
			}
		>
			{({ isActive }) => (
				<>
					{icon && (
						<span
							className={cn(
								"opacity-70",
								isActive && "text-petrol opacity-100",
							)}
						>
							<Icon name={icon} />
						</span>
					)}
					{children}
				</>
			)}
		</NavLink>
	);
}
