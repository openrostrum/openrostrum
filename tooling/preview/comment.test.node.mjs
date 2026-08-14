import assert from "node:assert/strict";
import { test } from "node:test";
import {
	COMMENT_MARKER,
	previewCommentBody,
	selectPreviewComment,
} from "../../scripts/preview/comment.mjs";

test("preview comment is one upsertable body with the workers.dev URL", () => {
	const body = previewCommentBody({
		url: "https://openrostrum-pr-9.example.workers.dev",
		pr: 9,
		sha: "abc1234",
	});
	assert.match(body, new RegExp(COMMENT_MARKER));
	assert.match(body, /https:\/\/openrostrum-pr-9\.example\.workers\.dev/);
	assert.match(body, /#9/);
	assert.match(body, /abc1234/);
	assert.doesNotMatch(body, /openrostrum\.com/);
	assert.doesNotMatch(body, /RESEND/);
});

test("comment selector finds the marker and ignores other comments", () => {
	const comments = [
		{ id: 1, body: "looks good" },
		{
			id: 2,
			body: previewCommentBody({ url: "https://a.workers.dev", pr: 1 }),
		},
		{ id: 3, body: "<!-- other-marker --> https://b.workers.dev" },
	];
	assert.equal(selectPreviewComment(comments)?.id, 2);
	assert.equal(selectPreviewComment([{ id: 4, body: "nope" }]), null);
});
