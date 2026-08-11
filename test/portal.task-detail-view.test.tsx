import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import {
	TaskDetailView,
	type TaskDetailData,
} from "../app/components/portal/task-detail-view";

const data = {
	base: "/portals/event/portal",
	id: "assignment-1",
	name: "Presentation upload",
	description: null,
	linkUrl: null,
	required: true,
	due: null,
	overdue: false,
	status: { label: "Pending review", tone: "info" },
	isComplete: false,
	completedOn: null,
	submissionTitle: "Session title",
	saved: null,
	kind: "file",
	uploadConstraints: "PDF up to 25 MB",
	form: null,
	fileRequest: {
		canUpload: false,
		files: [
			{
				id: "file-1",
				commentKey: "11111111-1111-4111-8111-111111111111",
				version: 1,
				fileName: "slides.pdf",
				size: "1 KB",
				uploadedOn: "Aug 10, 2026, 1:00 PM PDT",
				review: { label: "Pending review", tone: "info" },
				reviewNote: null,
				latest: true,
				comments: [],
			},
		],
	},
} as TaskDetailData;

describe("portal task comment thread", () => {
	it("explains an empty thread and its next action", () => {
		const router = createMemoryRouter(
			[
				{
					path: "*",
					element: <TaskDetailView data={data} />,
				},
			],
			{ initialEntries: ["/portals/event/portal/tasks/assignment-1"] },
		);
		const html = renderToStaticMarkup(<RouterProvider router={router} />);
		expect(html).toContain("No comments yet");
		expect(html).toContain("Write a comment below to start the thread");
	});
});
