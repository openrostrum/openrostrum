// Structured runtime events — the queryable record of what the app did
// (docs/observability.md). One JSON line per event so Workers Logs and
// `wrangler tail --format=json` can filter on fields, not grep prose.
type Fields = Record<string, string | number | boolean | null | undefined>;

export function track(evt: string, fields: Fields = {}): void {
	console.log(JSON.stringify({ evt, ...fields }));
}

type Mark = { name: string; dur: number };

export function serverTimingHeader(marks: readonly Mark[]): string {
	return marks.map((m) => `${m.name};dur=${m.dur.toFixed(1)}`).join(", ");
}

// Per-request phase timings, surfaced once as a Server-Timing header.
// Workers clocks only advance across I/O, so timed sections must await real
// I/O (DB, fetch) to show a duration — pure CPU reads as ~0 by design.
export function createTimings() {
	const marks: Mark[] = [];
	return {
		async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
			const start = performance.now();
			try {
				return await fn();
			} finally {
				marks.push({ name, dur: performance.now() - start });
			}
		},
		header: () => serverTimingHeader(marks),
	};
}
