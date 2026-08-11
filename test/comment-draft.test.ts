import { describe, expect, it } from "vitest";
import { resolveCommentDraft } from "../app/lib/comment-draft";

const initial = {
	key: "11111111-1111-4111-8111-111111111111",
	fileId: "v2",
	body: "Draft for v2",
};
const success = {
	ok: true,
	commentKey: "22222222-2222-4222-8222-222222222222",
	commentFileId: "v2",
};

describe("resolveCommentDraft", () => {
	it("keeps a failed retry on its original version through revalidation", () => {
		expect(
			resolveCommentDraft(
				initial,
				{
					commentKey: initial.key,
					commentFileId: "v2",
					commentBody: initial.body,
				},
				"v3",
			),
		).toEqual(initial);
	});

	it("lets a blank post-success form follow latest until the user types", () => {
		const blankOnV3 = resolveCommentDraft(initial, success, "v3");
		expect(blankOnV3).toEqual({
			key: success.commentKey,
			fileId: "v3",
			body: "",
		});

		const typedOnV3 = { ...blankOnV3, body: "New draft for v3" };
		expect(resolveCommentDraft(typedOnV3, success, "v4")).toEqual(typedOnV3);
	});

	it("restores a native-submit failure from echoed action data", () => {
		expect(
			resolveCommentDraft(
				{
					key: "33333333-3333-4333-8333-333333333333",
					fileId: "v3",
					body: "",
				},
				{
					commentKey: initial.key,
					commentFileId: initial.fileId,
					commentBody: initial.body,
				},
				"v3",
			),
		).toEqual(initial);
	});
});
