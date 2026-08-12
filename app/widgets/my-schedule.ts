import { useCallback, useEffect, useState } from "react";
import { StoredIds } from "../lib/stored-ids";

/**
 * Personal schedule = starred ids in localStorage, keyed per event; `ready`
 * stays false until after hydration so SSR and first client render agree.
 * Storage writes happen in an effect on COMMITTED state — updaters must stay
 * pure (React may defer/replay them), and a write inside one loses stars.
 */
const storageKey = (eventId: string) => `openrostrum.my-schedule.${eventId}`;

function readStored(eventId: string): string[] {
	try {
		const raw = window.localStorage.getItem(storageKey(eventId));
		return StoredIds.parse(raw ? JSON.parse(raw) : []);
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
