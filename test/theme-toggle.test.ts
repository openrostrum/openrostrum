import { Children, type ComponentProps, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { ThemeMenuForm } from "../app/components/theme-toggle";

describe("theme menu submission", () => {
	it("closes from the form submit event without unmounting option buttons on click", () => {
		let closed = false;
		const menu = ThemeMenuForm({
			Form: "form",
			busy: false,
			theme: "system",
			onSubmit: () => {
				closed = true;
			},
		});

		expect(menu.type).toBe("form");
		menu.props.onSubmit();
		expect(closed).toBe(true);

		const options = Children.toArray(menu.props.children) as ReactElement<
			ComponentProps<"button">
		>[];
		expect(options).toHaveLength(3);
		for (const option of options) {
			expect(option.props.type).toBe("submit");
			expect(option.props.onClick).toBeUndefined();
		}
	});

	it("opens below the trigger when used in a top header", () => {
		const menu = ThemeMenuForm({
			Form: "form",
			busy: false,
			theme: "system",
			placement: "below",
			onSubmit: () => undefined,
		});

		expect(menu.props.className).toContain("top-full");
		expect(menu.props.className).not.toContain("bottom-full");
	});
});
