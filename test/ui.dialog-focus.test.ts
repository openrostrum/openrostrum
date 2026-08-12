import { describe, expect, it } from "vitest";
import {
	focusDialogInitial,
	handleDialogKeyDown,
	restoreDialogFocus,
} from "../app/ui/dialog-focus";

type FocusState = { current: string | null };

function focusTarget(id: string, state: FocusState, isConnected = true) {
	return {
		focus: () => {
			state.current = id;
		},
		isConnected,
	} as unknown as HTMLElement;
}

function keyEvent(key: string, shiftKey = false) {
	let defaultPrevented = false;
	return {
		event: {
			key,
			shiftKey,
			preventDefault: () => {
				defaultPrevented = true;
			},
		} as unknown as KeyboardEvent,
		get defaultPrevented() {
			return defaultPrevented;
		},
	};
}

describe("dialog focus behavior", () => {
	it("focuses the first control and falls back to the panel", () => {
		const state: FocusState = { current: null };
		const panel = focusTarget("panel", state);
		const first = focusTarget("first", state);

		focusDialogInitial(panel, [first]);
		expect(state.current).toBe("first");

		focusDialogInitial(panel, []);
		expect(state.current).toBe("panel");
	});

	it("dismisses on Escape only when dismissal is available", () => {
		const state: FocusState = { current: null };
		const panel = {
			...focusTarget("panel", state),
			contains: () => true,
		} as unknown as HTMLElement;
		let dismissed = false;
		const allowed = keyEvent("Escape");

		handleDialogKeyDown({
			event: allowed.event,
			panel,
			candidates: [],
			active: null,
			onDismiss: () => {
				dismissed = true;
			},
		});
		expect({ dismissed, defaultPrevented: allowed.defaultPrevented }).toEqual({
			dismissed: true,
			defaultPrevented: true,
		});

		dismissed = false;
		const blocked = keyEvent("Escape");
		handleDialogKeyDown({
			event: blocked.event,
			panel,
			candidates: [],
			active: null,
		});
		expect({ dismissed, defaultPrevented: blocked.defaultPrevented }).toEqual({
			dismissed: false,
			defaultPrevented: false,
		});
	});

	it("contains forward, backward, outside, and empty Tab focus", () => {
		const state: FocusState = { current: null };
		const first = focusTarget("first", state);
		const middle = focusTarget("middle", state);
		const last = focusTarget("last", state);
		const panel = {
			...focusTarget("panel", state),
			contains: (active: Node | null) => active !== null,
		} as unknown as HTMLElement;

		const forward = keyEvent("Tab");
		handleDialogKeyDown({
			event: forward.event,
			panel,
			candidates: [first, middle, last],
			active: last,
		});
		expect({ focus: state.current, wrapped: forward.defaultPrevented }).toEqual(
			{
				focus: "first",
				wrapped: true,
			},
		);

		const backward = keyEvent("Tab", true);
		handleDialogKeyDown({
			event: backward.event,
			panel,
			candidates: [first, middle, last],
			active: first,
		});
		expect({
			focus: state.current,
			wrapped: backward.defaultPrevented,
		}).toEqual({
			focus: "last",
			wrapped: true,
		});

		const outside = keyEvent("Tab");
		handleDialogKeyDown({
			event: outside.event,
			panel,
			candidates: [first],
			active: null,
		});
		expect({
			focus: state.current,
			contained: outside.defaultPrevented,
		}).toEqual({
			focus: "first",
			contained: true,
		});

		const empty = keyEvent("Tab");
		handleDialogKeyDown({
			event: empty.event,
			panel,
			candidates: [],
			active: null,
		});
		expect({ focus: state.current, contained: empty.defaultPrevented }).toEqual(
			{
				focus: "panel",
				contained: true,
			},
		);
	});

	it("restores focus only while the prior trigger remains connected", () => {
		const state: FocusState = { current: null };
		const connected = focusTarget("connected", state);
		const removed = focusTarget("removed", state, false);

		restoreDialogFocus(connected);
		expect(state.current).toBe("connected");

		restoreDialogFocus(removed);
		expect(state.current).toBe("connected");
	});
});
