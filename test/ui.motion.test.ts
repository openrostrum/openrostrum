import { describe, expect, it } from "vitest";
import { createInputModalityTracker } from "../app/ui/motion";

describe("entry motion input policy", () => {
	it("tracks input modality until its listeners are removed", () => {
		const events = new EventTarget();
		const target: Pick<
			EventTarget,
			"addEventListener" | "removeEventListener"
		> = {
			addEventListener: (type, listener) =>
				events.addEventListener(type, listener),
			removeEventListener: (type, listener) =>
				events.removeEventListener(type, listener),
		};
		const tracker = createInputModalityTracker();
		const stopListening = tracker.listen(target);

		expect(tracker.allowsEntryMotion()).toBe(true);

		events.dispatchEvent(new Event("keydown"));
		expect(tracker.allowsEntryMotion()).toBe(false);

		events.dispatchEvent(new Event("pointerdown"));
		expect(tracker.allowsEntryMotion()).toBe(true);

		stopListening();
		events.dispatchEvent(new Event("keydown"));
		expect(tracker.allowsEntryMotion()).toBe(true);
	});
});
