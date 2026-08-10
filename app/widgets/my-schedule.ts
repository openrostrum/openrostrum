import { useCallback, useEffect, useState } from "react";

/**
 * Personal schedule = starred session ids in localStorage, keyed per event.
 * No account required to browse or star; `ready` stays false until after
 * hydration so the server and first client render agree (nothing starred).
 * Persistence happens in an effect on the COMMITTED state — a state updater
 * must stay pure (React may defer or replay it), so writing storage inside
 * one silently loses stars.
 */
const storageKey = (eventId: string) => `openrostrum.my-schedule.${eventId}`;

function readStored(eventId: string): string[] {
	try {
		const raw = window.localStorage.getItem(storageKey(eventId));
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed)
			? parsed.filter((v): v is string => typeof v === "string")
			: [];
	} catch {
		return [];
	}
}

export function useMySchedule(eventId: string) {
	const [ready, setReady] = useState(false);
	const [ids, setIds] = useState<ReadonlySet<string>>(new Set());

	useEffect(() => {
		setIds(new Set(readStored(eventId)));
		setReady(true);
	}, [eventId]);

	useEffect(() => {
		if (!ready) return;
		try {
			window.localStorage.setItem(
				storageKey(eventId),
				JSON.stringify([...ids]),
			);
		} catch {
			// Storage full/blocked: the in-memory set still works this visit.
		}
	}, [ids, ready, eventId]);

	const toggle = useCallback((sessionId: string) => {
		setIds((current) => {
			const next = new Set(current);
			if (next.has(sessionId)) next.delete(sessionId);
			else next.add(sessionId);
			return next;
		});
	}, []);

	return { ready, ids, toggle };
}
