import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/ui class combiner: merge conditional classes, de-duping Tailwind. */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
