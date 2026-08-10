import { afterEach, describe, expect, it, vi } from "vitest";
import { attemptClipboardWrite } from "~/components/copy-button";

describe("attemptClipboardWrite", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("invokes the fallback when the Clipboard API is absent", () => {
		vi.stubGlobal("navigator", {});
		const onFailure = vi.fn();

		expect(attemptClipboardWrite("invite link", onFailure)).toBeUndefined();
		expect(onFailure).toHaveBeenCalledOnce();
	});

	it("invokes the fallback when writeText throws synchronously", () => {
		const writeText = vi.fn(() => {
			throw new Error("clipboard blocked");
		});
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		const onFailure = vi.fn();

		expect(() => attemptClipboardWrite("invite link", onFailure)).not.toThrow();
		expect(writeText).toHaveBeenCalledWith("invite link");
		expect(onFailure).toHaveBeenCalledOnce();
	});
});
