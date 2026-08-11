import { afterEach, describe, expect, it, vi } from "vitest";
import {
	attemptClipboardWrite,
	handleClipboardFeedback,
} from "~/components/copy-button";

type Feedback = "copied" | "failed";

function recordFeedback() {
	const outcome = { feedback: [] as Feedback[], failures: 0 };
	return {
		outcome,
		onFeedback: (feedback: Feedback) => outcome.feedback.push(feedback),
		onFailure: () => {
			outcome.failures += 1;
		},
	};
}

describe("clipboard feedback", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("does not report optimistic success when the Clipboard API is absent", async () => {
		vi.stubGlobal("navigator", {});
		const recorder = recordFeedback();

		await handleClipboardFeedback(
			attemptClipboardWrite("invite link", recorder.onFailure),
			{
				optimistic: true,
				showFailure: false,
				onFeedback: recorder.onFeedback,
				onFailure: recorder.onFailure,
			},
		);

		expect(recorder.outcome).toEqual({ feedback: [], failures: 1 });
	});

	it("invokes the fallback without feedback when writeText throws synchronously", async () => {
		const writeText = vi.fn(() => {
			throw new Error("clipboard blocked");
		});
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		const recorder = recordFeedback();

		const write = attemptClipboardWrite("invite link", recorder.onFailure);
		await handleClipboardFeedback(write, {
			optimistic: true,
			showFailure: false,
			onFeedback: recorder.onFeedback,
			onFailure: recorder.onFailure,
		});

		expect(recorder.outcome).toEqual({ feedback: [], failures: 1 });
		expect(writeText).toHaveBeenCalledWith("invite link");
	});

	it("reports copied after an awaited write succeeds", async () => {
		const recorder = recordFeedback();

		await handleClipboardFeedback(Promise.resolve(), {
			optimistic: false,
			showFailure: true,
			onFeedback: recorder.onFeedback,
			onFailure: recorder.onFailure,
		});

		expect(recorder.outcome).toEqual({
			feedback: ["copied"],
			failures: 0,
		});
	});

	it("reports a visible failure after an awaited write rejects", async () => {
		const recorder = recordFeedback();

		await handleClipboardFeedback(Promise.reject(new Error("denied")), {
			optimistic: false,
			showFailure: true,
			onFeedback: recorder.onFeedback,
			onFailure: recorder.onFailure,
		});

		expect(recorder.outcome).toEqual({
			feedback: ["failed"],
			failures: 1,
		});
	});

	it("keeps an awaited rejection silent when failure feedback is disabled", async () => {
		const recorder = recordFeedback();

		await handleClipboardFeedback(Promise.reject(new Error("denied")), {
			optimistic: false,
			showFailure: false,
			onFeedback: recorder.onFeedback,
			onFailure: recorder.onFailure,
		});

		expect(recorder.outcome).toEqual({ feedback: [], failures: 1 });
	});

	it("reports optimistic success immediately when a write Promise exists", async () => {
		const recorder = recordFeedback();
		const feedback = handleClipboardFeedback(Promise.resolve(), {
			optimistic: true,
			showFailure: false,
			onFeedback: recorder.onFeedback,
			onFailure: recorder.onFailure,
		});

		expect(recorder.outcome).toEqual({
			feedback: ["copied"],
			failures: 0,
		});
		await feedback;
		expect(recorder.outcome).toEqual({
			feedback: ["copied"],
			failures: 0,
		});
	});

	it("preserves immediate optimistic feedback when the write Promise rejects", async () => {
		let rejectWrite!: (error: Error) => void;
		const write = new Promise<void>((_resolve, reject) => {
			rejectWrite = reject;
		});
		const recorder = recordFeedback();
		const feedback = handleClipboardFeedback(write, {
			optimistic: true,
			showFailure: true,
			onFeedback: recorder.onFeedback,
			onFailure: recorder.onFailure,
		});

		expect(recorder.outcome).toEqual({
			feedback: ["copied"],
			failures: 0,
		});
		rejectWrite(new Error("denied"));
		await feedback;
		expect(recorder.outcome).toEqual({
			feedback: ["copied"],
			failures: 1,
		});
	});
});
