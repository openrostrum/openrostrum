import {
	createContext,
	type ComponentPropsWithoutRef,
	type ElementType,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { cn } from "./cn";
import {
	focusDialogInitial,
	handleDialogKeyDown,
	restoreDialogFocus,
} from "./dialog-focus";

export { MOTION_FEEDBACK } from "./motion-classes";

const ENTER = cn(
	"transition-[opacity,translate,scale]",
	"[transition-duration:var(--motion-duration-enter)]",
	"[transition-timing-function:var(--ease-gallery-settle)]",
	"motion-reduce:transition-none",
);

type InputModality = "keyboard" | "pointer";
type InputModalityTarget = Pick<
	EventTarget,
	"addEventListener" | "removeEventListener"
>;

type InputModalityTracker = {
	allowsEntryMotion: () => boolean;
	listen: (target: InputModalityTarget) => () => void;
};

export function createInputModalityTracker(): InputModalityTracker {
	let input: InputModality = "pointer";
	return {
		allowsEntryMotion: () => input === "pointer",
		listen: (target) => {
			const onPointerDown = () => {
				input = "pointer";
			};
			const onKeyDown = () => {
				input = "keyboard";
			};
			target.addEventListener("pointerdown", onPointerDown, true);
			target.addEventListener("keydown", onKeyDown, true);
			return () => {
				target.removeEventListener("pointerdown", onPointerDown, true);
				target.removeEventListener("keydown", onKeyDown, true);
			};
		},
	};
}

const InputModalityContext = createContext<InputModalityTracker | null>(null);

export function MotionInputBoundary({ children }: { children: ReactNode }) {
	const [tracker] = useState(createInputModalityTracker);

	useEffect(() => tracker.listen(document), [tracker]);

	return (
		<InputModalityContext.Provider value={tracker}>
			{children}
		</InputModalityContext.Provider>
	);
}

function useEntryMotion() {
	const tracker = useContext(InputModalityContext);
	const [animate] = useState(() => tracker?.allowsEntryMotion() ?? true);
	return animate;
}

const STARTING_FADE = cn(
	"starting:opacity-0",
	"motion-reduce:starting:opacity-100",
);

const STARTING_REVEAL = cn(
	STARTING_FADE,
	"starting:translate-y-0.5 motion-reduce:starting:translate-y-0",
);

export function MotionReveal({
	children,
	kind = "panel",
}: {
	children: ReactNode;
	kind?: "panel" | "feedback";
}) {
	const animate = useEntryMotion();
	const className = animate ? cn(ENTER, STARTING_REVEAL) : undefined;
	return kind === "feedback" ? (
		<span className={cn("inline-flex", className)}>{children}</span>
	) : (
		<div className={className}>{children}</div>
	);
}

const SIDE = {
	top: "bottom-full mb-[6px]",
	bottom: "top-full mt-[6px]",
} as const;

const STARTING_OFFSET = {
	top: "starting:translate-y-0.5 motion-reduce:starting:translate-y-0",
	bottom: "starting:-translate-y-0.5 motion-reduce:starting:translate-y-0",
} as const;

const ALIGN = {
	start: "left-0",
	end: "right-0",
	stretch: "inset-x-0",
} as const;

const ORIGIN = {
	top: {
		start: "origin-bottom-left",
		end: "origin-bottom-right",
		stretch: "origin-bottom",
	},
	bottom: {
		start: "origin-top-left",
		end: "origin-top-right",
		stretch: "origin-top",
	},
} as const;

const WIDTH = {
	sm: "w-[168px]",
	md: "w-64",
	trigger: "w-full",
} as const;

const PADDING = {
	none: "",
	menu: "py-1",
} as const;

type PopoverSurfaceOptions = {
	side: keyof typeof SIDE;
	align?: keyof typeof ALIGN;
	width?: keyof typeof WIDTH;
	padding?: keyof typeof PADDING;
};

type PopoverSurfaceProps<T extends ElementType> = PopoverSurfaceOptions & {
	as?: T;
	children: ReactNode;
} & Omit<
		ComponentPropsWithoutRef<T>,
		keyof PopoverSurfaceOptions | "as" | "children" | "className" | "style"
	>;

function popoverSurfaceClassName(
	{
		side,
		align = "start",
		width = "sm",
		padding = "none",
	}: PopoverSurfaceOptions,
	animate: boolean,
): string {
	return cn(
		"absolute z-30 flex flex-col overflow-hidden rounded-card bg-surface shadow-card",
		SIDE[side],
		ALIGN[align],
		ORIGIN[side][align],
		WIDTH[width],
		PADDING[padding],
		animate && [
			ENTER,
			STARTING_FADE,
			STARTING_OFFSET[side],
			"starting:scale-[0.98] motion-reduce:starting:scale-100",
		],
	);
}

export function PopoverSurface<T extends ElementType = "div">({
	as,
	side,
	align,
	width,
	padding,
	...props
}: PopoverSurfaceProps<T>) {
	const animate = useEntryMotion();
	const Component = (as ?? "div") as ElementType;
	return (
		<Component
			{...props}
			className={popoverSurfaceClassName(
				{
					side,
					align,
					width,
					padding,
				},
				animate,
			)}
		/>
	);
}

const DIALOG_SIZE = {
	sm: "max-w-md",
	md: "max-w-2xl",
	lg: "max-w-4xl",
} as const;

const FOCUSABLE =
	'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useDialogFocus(onDismiss: (() => void) | undefined) {
	const panelRef = useRef<HTMLDivElement>(null);
	const dismissRef = useRef(onDismiss);

	useEffect(() => {
		dismissRef.current = onDismiss;
	}, [onDismiss]);

	useEffect(() => {
		const panel = panelRef.current;
		if (!panel) return;
		const previous =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const focusable = () =>
			Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
		focusDialogInitial(panel, focusable());

		const onKeyDown = (event: KeyboardEvent) => {
			const panel = panelRef.current;
			if (!panel) return;
			handleDialogKeyDown({
				event,
				panel,
				candidates: focusable(),
				active: document.activeElement,
				onDismiss: dismissRef.current,
			});
		};

		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			if (previous) restoreDialogFocus(previous);
		};
	}, []);

	return panelRef;
}

export function DialogSurface({
	children,
	role = "dialog",
	size = "lg",
	ariaLabel,
	labelledBy,
	describedBy,
	onDismiss,
}: {
	children: ReactNode;
	role?: "dialog" | "alertdialog";
	size?: keyof typeof DIALOG_SIZE;
	ariaLabel?: string;
	labelledBy?: string;
	describedBy?: string;
	onDismiss?: () => void;
}) {
	const animate = useEntryMotion();
	const panelRef = useDialogFocus(onDismiss);
	return (
		<div
			className={cn(
				"fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4",
				animate && [
					"transition-opacity [transition-duration:var(--motion-duration-enter)] [transition-timing-function:var(--ease-gallery-settle)]",
					"starting:opacity-0 motion-reduce:transition-none motion-reduce:starting:opacity-100",
				],
			)}
			role="presentation"
		>
			<div
				ref={panelRef}
				tabIndex={-1}
				role={role}
				aria-modal="true"
				aria-label={ariaLabel}
				aria-labelledby={labelledBy}
				aria-describedby={describedBy}
				className={cn(
					"flex max-h-[92vh] w-full flex-col overflow-y-auto rounded-card bg-surface p-5 shadow-card",
					DIALOG_SIZE[size],
					animate && [
						"transition-[scale] [transition-duration:var(--motion-duration-enter)] [transition-timing-function:var(--ease-gallery-settle)]",
						"starting:scale-[0.97] motion-reduce:transition-none motion-reduce:starting:scale-100",
					],
				)}
			>
				{children}
			</div>
		</div>
	);
}
