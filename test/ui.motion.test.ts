import { describe, expect, it } from "vitest";
import { allowsEntryMotion } from "../app/ui/motion";

describe("entry motion input policy", () => {
	it("animates pointer entry but keeps keyboard entry static", () => {
		expect({
			pointer: allowsEntryMotion("pointer"),
			keyboard: allowsEntryMotion("keyboard"),
		}).toEqual({
			pointer: true,
			keyboard: false,
		});
	});
});
