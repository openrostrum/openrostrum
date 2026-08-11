# Portal Admin Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish and prove event-scoped portal forms, custom statuses, and exact speaker-read/read-only organizer preview after integrating `origin/main`.

**Architecture:** Keep the implemented event-scoped form and status surfaces. Introduce one effective portal read subject in `PortalContext`, so every loader derives speaker-owned data from the selected preview contact while authorization remains the real organizer session. Move initial task-form persistence behind one atomic compare-and-set helper so concurrent first submissions cannot both succeed.

**Tech Stack:** React Router 7 loaders/actions, TypeScript, Drizzle ORM, Cloudflare Workers/workerd, D1, R2, Vitest, pnpm, GitHub CLI.

## Global Constraints

- Production software for hundreds of contacts/submissions; no demo-only shortcuts.
- Merge `origin/main` with a merge commit; never rebase. Completed in `c7ee521`.
- Portal forms and custom statuses are scoped to the active event in every read and write.
- Preview never swaps the organizer session or creates a speaker session/login link.
- The preview cookie is a selector, never an authorization credential.
- Preview mutations return HTTP 403 before D1, R2, outbox, or external side effects.
- UI uses the existing design system and in-app destructive confirmation; no native `confirm()`.
- Do not add a migration or run `pnpm db:generate` in this feature worktree.
- Keep the Library status diff disjoint from Lane D's Fields section.
- Run `pnpm verify`, perform the live fresh-organization scenario, run judge loop suffix `-portal-admin` for at most three rounds, resolve every inline AI-review thread, and do not merge PR #73.

## File Structure

- `app/domain/portal.ts` — portal authorization context and effective read-subject ownership gates.
- `app/domain/portal-task-form.ts` — focused atomic first-response persistence helper.
- `app/routes/portals.$eventSlug.$portalId.home.tsx` — home submission summary using the effective subject.
- `app/routes/portals.$eventSlug.$portalId.submissions.tsx` — submission list using the effective subject.
- `app/routes/portals.$eventSlug.$portalId.submissions_.$submissionId.tsx` — selected-speaker detail affordances; actions remain real-session attributed after preview denial.
- `app/routes/portals.$eventSlug.$portalId.tasks_.$assignmentId.tsx` — selected-speaker comment labels and atomic form submission.
- `test/portal.preview.test.ts` — linked-account read parity, participant affordances, and crafted mutation denial.
- `test/portal.tasks.test.ts` — atomic first-response persistence and route integration.
- `test/admin.portal-forms.route.test.ts` — bidirectional form tenancy.
- `test/library.session-statuses.test.ts` — bidirectional custom-status tenancy.
- `docs/superpowers/specs/2026-08-10-portal-admin-depth-design.md` — approved security and product design.
- `docs/judge-loop-portal-admin.md` — round-by-round finding dispositions created during convergence.

---

### Task 1: Make preview GETs use the selected speaker's complete identity

**Files:**
- Modify: `app/domain/portal.ts:83-314`
- Modify: `app/routes/portals.$eventSlug.$portalId.home.tsx:16-27`
- Modify: `app/routes/portals.$eventSlug.$portalId.submissions.tsx:16-23`
- Modify: `app/routes/portals.$eventSlug.$portalId.submissions_.$submissionId.tsx:45-204`
- Modify: `app/routes/portals.$eventSlug.$portalId.tasks_.$assignmentId.tsx:156-177`
- Test: `test/portal.preview.test.ts`

**Interfaces:**
- Consumes: `contacts.userId`, the selected `PortalContext.contact`, and real-session authorization already enforced by `getPortalContext(env, user, params, request)`.
- Produces: `PortalContext.subjectUserId: string | null`; `listPortalSubmissions(env, ctx)`; `requireOwnedSubmission(env, ctx, submissionId)`.

- [ ] **Step 1: Add submitter-only and participant-affordance fixtures**

Extend `seedPreviewWorld()` after task assignments:

```ts
await db.insert(submissions).values([
	{
		id: "s_priya_owned",
		eventId: "e1",
		title: "Priya's proposal",
		status: "pending",
		submitterId: "u_priya",
	},
	{
		id: "s_panel",
		eventId: "e1",
		title: "Speaker panel",
		status: "accepted",
		submitterId: "u_mallory",
	},
]);
await db.insert(participants).values([
	{
		id: "p_priya",
		submissionId: "s_panel",
		contactId: "c_priya",
	},
	{
		id: "p_mallory",
		submissionId: "s_panel",
		contactId: "c_mallory",
	},
]);
```

Import `participants` and `submissions`, the submissions-list loader, and both loader/action exports from submission detail.

- [ ] **Step 2: Write the failing read-parity test**

```ts
it("uses the selected speaker's linked account for every submission read affordance", async () => {
	await seedPreviewWorld();
	const list = unwrap<{
		submissions: Array<{ id: string }>;
	}>(
		await submissionsLoader({
			context: CONTEXT,
			request: await requestWithPreview("u_admin", `${BASE}/submissions`),
			params: PORTAL_PARAMS,
		} as unknown as Parameters<typeof submissionsLoader>[0]),
	);
	expect(list.submissions.map((row) => row.id)).toContain("s_priya_owned");

	const owned = unwrap<{
		canWithdrawSubmission: boolean;
	}>(
		await submissionDetailLoader({
			context: CONTEXT,
			request: await requestWithPreview(
				"u_admin",
				`${BASE}/submissions/s_priya_owned`,
			),
			params: { ...PORTAL_PARAMS, submissionId: "s_priya_owned" },
		} as unknown as Parameters<typeof submissionDetailLoader>[0]),
	);
	expect(owned.canWithdrawSubmission).toBe(true);

	const panel = unwrap<{
		participants: Array<{ id: string; isMe: boolean; removable: boolean }>;
	}>(
		await submissionDetailLoader({
			context: CONTEXT,
			request: await requestWithPreview(
				"u_admin",
				`${BASE}/submissions/s_panel`,
			),
			params: { ...PORTAL_PARAMS, submissionId: "s_panel" },
		} as unknown as Parameters<typeof submissionDetailLoader>[0]),
	);
	expect(panel.participants.find((p) => p.id === "p_priya")).toMatchObject({
		isMe: true,
		removable: false,
	});
});
```

- [ ] **Step 3: Run the test and verify the current admin-ID bug**

Run:

```bash
pnpm exec vitest run test/portal.preview.test.ts
```

Expected: FAIL because `s_priya_owned` is absent; the current list filters `submissions.submitterId` with `u_admin`.

- [ ] **Step 4: Add one effective read subject to `PortalContext`**

Change the type and both return paths:

```ts
export type PortalContext = {
	event: AppEvent;
	portal: Portal;
	contact: Contact | null;
	/** Account whose ownership portal GETs project; null for an unlinked preview contact. */
	subjectUserId: string | null;
	preview: { contactName: string } | null;
};
```

Preview return:

```ts
return {
	event,
	portal,
	contact: previewContact,
	subjectUserId: previewContact.userId,
	preview: { contactName: contactDisplayName(previewContact) },
};
```

Normal return:

```ts
return {
	event,
	portal,
	contact: contact ?? null,
	subjectUserId: user.id,
	preview: null,
};
```

Keep real-session membership authorization and non-GET/HEAD denial exactly where they are.

- [ ] **Step 5: Make ownership helpers consume only the context subject**

Change the signatures:

```ts
export async function listPortalSubmissions(
	env: Env,
	ctx: PortalContext,
): Promise<PortalSubmissionRow[]>;

export async function requireOwnedSubmission(
	env: Env,
	ctx: PortalContext,
	submissionId: string,
);
```

Run the submitter-owned query only when `ctx.subjectUserId` is non-null and filter with:

```ts
eq(submissions.submitterId, ctx.subjectUserId)
```

Change the fallback ownership gate to:

```ts
if (!myParticipant && submission.submitterId !== ctx.subjectUserId)
	throw data(null, { status: 404 });
```

Remove `user.id` from both list call sites and all `requireOwnedSubmission` call sites. This prevents any future loader from accidentally reintroducing the real organizer ID.

- [ ] **Step 6: Project detail affordances from `ctx.subjectUserId`**

In the submission-detail loader use:

```ts
isMe: p.contactUserId === ctx.subjectUserId,
removable: p.contactUserId !== ctx.subjectUserId,
canWithdrawSubmission:
	submission.submitterId === ctx.subjectUserId &&
	!["withdrawn", "declined", "draft"].includes(submission.status),
```

In the task-detail loader use:

```ts
isYou: c.authorId === ctx.subjectUserId,
```

Do not change action attribution (`withdrawnById`, revision editor, comment author): preview requests have already been rejected, so genuine mutations must remain attributed to the authenticated user.

- [ ] **Step 7: Add a crafted submission-mutation denial assertion**

Inside the existing server-side mutation test, POST `withdraw-submission` to `s_priya_owned` with the preview cookie, assert 403, then assert the row remains `pending`:

```ts
const withdrawThrown = await catchThrown(() =>
	submissionDetailAction({
		context: CONTEXT,
		request: await requestWithPreview(
			"u_admin",
			`${BASE}/submissions/s_priya_owned`,
			{
				method: "POST",
				body: new URLSearchParams({ intent: "withdraw-submission" }),
			},
		),
		params: { ...PORTAL_PARAMS, submissionId: "s_priya_owned" },
	} as unknown as Parameters<typeof submissionDetailAction>[0]),
);
expect(thrownStatus(withdrawThrown)).toBe(403);
const [owned] = await db
	.select()
	.from(submissions)
	.where(eq(submissions.id, "s_priya_owned"));
expect(owned?.status).toBe("pending");
```

- [ ] **Step 8: Run the preview and adjacent portal tests**

Run:

```bash
pnpm exec vitest run \
  test/portal.preview.test.ts \
  test/portal.access.test.ts \
  test/portal.participation.test.ts \
  test/portal.editing.test.ts \
  test/portal.tasks.test.ts
```

Expected: all pass.

- [ ] **Step 9: Commit the effective-subject fix**

```bash
git add app/domain/portal.ts \
  'app/routes/portals.$eventSlug.$portalId.home.tsx' \
  'app/routes/portals.$eventSlug.$portalId.submissions.tsx' \
  'app/routes/portals.$eventSlug.$portalId.submissions_.$submissionId.tsx' \
  'app/routes/portals.$eventSlug.$portalId.tasks_.$assignmentId.tsx' \
  test/portal.preview.test.ts
git commit -m "fix(portal): project preview reads as selected speaker" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Make first portal-form submission atomic

**Files:**
- Create: `app/domain/portal-task-form.ts`
- Modify: `app/routes/portals.$eventSlug.$portalId.tasks_.$assignmentId.tsx:277-363`
- Test: `test/portal.tasks.test.ts`

**Interfaces:**
- Consumes: `Db`, `taskAssignments`, assignment/contact ownership, validated answer JSON.
- Produces: `persistInitialPortalFormResponse(db, input): Promise<boolean>` where `true` is the sole winning first write.

- [ ] **Step 1: Write the failing atomic-claim test against the desired API**

Add this import:

```ts
import { persistInitialPortalFormResponse } from "../app/domain/portal-task-form";
```

Add the test:

```ts
it("atomically persists only one concurrent first form response", async () => {
	await seedTasks();
	const db = getDb(env);
	const completedAt = new Date("2026-10-01T12:00:00Z");
	const [first, second] = await Promise.all([
		persistInitialPortalFormResponse(db, {
			assignmentId: "ta_hotel",
			contactId: "c_priya",
			answers: { "Check-in Date": "2026-10-11" },
			completedAt,
		}),
		persistInitialPortalFormResponse(db, {
			assignmentId: "ta_hotel",
			contactId: "c_priya",
			answers: { "Check-in Date": "2026-10-12" },
			completedAt,
		}),
	]);
	expect([first, second].sort()).toEqual([false, true]);
	const [row] = await db
		.select()
		.from(taskAssignments)
		.where(eq(taskAssignments.id, "ta_hotel"));
	expect(row?.status).toBe("complete");
	expect([
		"2026-10-11",
		"2026-10-12",
	]).toContain((row?.response as Record<string, string> | null)?.["Check-in Date"]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm exec vitest run test/portal.tasks.test.ts
```

Expected: FAIL at import resolution because `app/domain/portal-task-form.ts` does not exist.

- [ ] **Step 3: Implement the atomic compare-and-set helper**

Create `app/domain/portal-task-form.ts`:

```ts
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "~/db";
import { taskAssignments } from "~/db/schema";

export async function persistInitialPortalFormResponse(
	db: Db,
	input: {
		assignmentId: string;
		contactId: string;
		answers: Record<string, unknown>;
		completedAt: Date;
	},
): Promise<boolean> {
	const [updated] = await db
		.update(taskAssignments)
		.set({
			status: "complete",
			completedAt: input.completedAt,
			response: input.answers,
		})
		.where(
			and(
				eq(taskAssignments.id, input.assignmentId),
				eq(taskAssignments.contactId, input.contactId),
				isNull(taskAssignments.response),
			),
		)
		.returning({ id: taskAssignments.id });
	return updated !== undefined;
}
```

- [ ] **Step 4: Verify the helper test is GREEN**

Run:

```bash
pnpm exec vitest run test/portal.tasks.test.ts
```

Expected: all portal-task tests pass.

- [ ] **Step 5: Route validated submissions through the helper**

Import `persistInitialPortalFormResponse`. Inside the `submit-form` branch, narrow the route invariant once:

```ts
if (!ctx.contact) throw data(null, { status: 404 });
```

Replace the direct update with:

```ts
const persisted = await timings.time("db", () =>
	persistInitialPortalFormResponse(db, {
		assignmentId: assignment.id,
		contactId: ctx.contact.id,
		answers,
		completedAt: new Date(),
	}),
);
if (!persisted) {
	return fail({
		formError:
			"This form was already submitted — contact the event team to change your answers.",
	});
}
```

Keep the fast pre-check for normal repeats, but make the helper result the final authority. Send confirmation email and track success only when `persisted` is true.

- [ ] **Step 6: Run route and form-builder tests**

Run:

```bash
pnpm exec vitest run \
  test/portal.tasks.test.ts \
  test/admin.portal-forms.route.test.ts \
  test/admin.tasks.assignment.route.test.ts
```

Expected: all pass, including one confirmation outbox row on a successful route submission.

- [ ] **Step 7: Commit the atomic response fix**

```bash
git add app/domain/portal-task-form.ts \
  'app/routes/portals.$eventSlug.$portalId.tasks_.$assignmentId.tsx' \
  test/portal.tasks.test.ts
git commit -m "fix(portal): atomically accept first form response" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Prove tenancy in both directions

**Files:**
- Test: `test/admin.portal-forms.route.test.ts:293-355`
- Test: `test/library.session-statuses.test.ts:119-153`

**Interfaces:**
- Consumes: existing route actions/loaders and two-organization fixtures.
- Produces: regression evidence that A cannot affect B and B cannot affect A for forms and custom statuses.

- [ ] **Step 1: Strengthen the portal-form fixture with an Event B form**

In the existing cross-tenant test, insert:

```ts
await db.insert(portalForms).values({
	id: "pf_other",
	eventId: "e2",
	name: "Other Travel",
	title: "Other event only",
	schema: [{ name: "Carrier", type: "text", required: true }],
});
```

Change the Event B loader assertion to:

```ts
expect(data.forms.map((form) => form.id)).toEqual(["pf_other"]);
```

After the existing B→A forged update, use the default Event A session to attempt updating `pf_other`; expect `/no longer exists/`. Assert `pf_hotel` remains `"Hotel Stay"` and `pf_other` remains `"Other Travel"`.

- [ ] **Step 2: Run the form tenancy test**

Run:

```bash
pnpm exec vitest run test/admin.portal-forms.route.test.ts
```

Expected: pass; each loader shows only its own event and both forged updates touch zero rows.

- [ ] **Step 3: Strengthen custom-status tenancy in both directions**

In the rename/forgery test, insert both rows:

```ts
await db.insert(sessionStatuses).values([
	{
		id: "st_offered",
		eventId: "e_a",
		name: "Offered",
		color: "#0E6C66",
	},
	{
		id: "st_foreign",
		eventId: "e_b",
		name: "Contracted",
		color: "#2563EB",
	},
]);
```

Keep the successful A rename and B→A forgery. Add A→B:

```ts
const reverseForged = await post({
	intent: "status.update",
	id: "st_foreign",
	name: "Also hijacked",
	color: "#000000",
});
expect(reverseForged.formError).toMatch(/no longer exists/);
const rows = await db.select().from(sessionStatuses);
expect(rows.find((row) => row.id === "st_offered")?.name).toBe("Offer Sent");
expect(rows.find((row) => row.id === "st_foreign")?.name).toBe("Contracted");
```

Update broad single-row assertions in this test to select by ID.

- [ ] **Step 4: Run all status and assignment tests**

Run:

```bash
pnpm exec vitest run \
  test/library.session-statuses.test.ts \
  test/admin.submissions.detail.route.test.ts
```

Expected: pass; custom status creation/assignment/deletion remain event-scoped.

- [ ] **Step 5: Commit tenancy evidence**

```bash
git add test/admin.portal-forms.route.test.ts \
  test/library.session-statuses.test.ts
git commit -m "test(portal): prove admin tenancy both directions" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Run repository and live acceptance verification

**Files:**
- Modify only when an observed failure has a TDD reproduction.
- Evidence source: command output, real HTTP responses, local D1/R2/outbox rows.

**Interfaces:**
- Consumes: completed Tasks 1–3 and `VERIFICATION-CAPABILITIES.md`.
- Produces: fresh evidence for form→task→speaker, status→assignment, and read-only preview.

- [ ] **Step 1: Run the full repository gate**

Run:

```bash
pnpm verify
```

Expected: exit 0 with map, formatting, lint, typecheck, and all workerd/D1 tests green. Record the exact test count.

- [ ] **Step 2: Start from a known local database**

Inspect the worktree-local D1 location, then run the repository's documented reset:

```bash
pnpm db:reset
pnpm dev:worktree
```

Use the `run` skill to drive the actual app; keep the server log and final URL as evidence.

- [ ] **Step 3: Create the fresh organization and speaker through real routes**

Using a unique local email, complete signup and onboarding for `Lane N Verification`. Through the public CFP, create a separate speaker account/contact and a submission, then accept it as the organizer so the contact, portal access, and task-assignment path are real rather than manually seeded.

- [ ] **Step 4: Verify portal form creation and speaker rendering**

As organizer:

1. Open **Portal forms**.
2. Create `Travel confirmation` with required dropdown `Travel method` (`Flight`, `Train`, `Car`) and optional text `Arrival notes`.
3. Create task definition `Confirm travel` with completion `Travel confirmation` and assign it to the speaker.

As the real speaker session, open **Tasks**, confirm `Confirm travel` renders both fields, submit `Flight` plus `Terminal 2`, then verify the organizer assignment detail shows those exact answers. Query D1 only as a postcondition oracle, not as the write path.

- [ ] **Step 5: Verify custom-status creation and assignment**

As organizer, open **Settings → Library**, create `Travel confirmed` with `#0E6C66`, assign it on the speaker's submission, reload, and confirm the label/color persist. Attempt a forged assignment with another event's status ID through a crafted request; require an error and unchanged submission.

- [ ] **Step 6: Verify exact read-only preview**

Select the speaker with **View portal as**. Confirm:

- the banner names the speaker on home, tasks, submission list, and submission detail;
- the speaker's task, submitter-owned submission, `isMe` participant state, and submitted form answer are visible;
- mutation controls are disabled;
- a crafted task-form POST and submission-withdraw POST each return 403;
- D1 assignment response/status and submission status remain unchanged;
- no new auth session for the speaker and no login-link/email side effect appears;
- exiting preview returns to the organizer without any session swap.

- [ ] **Step 7: Commit only evidence-driven fixes**

For any observed failure, invoke `superpowers:systematic-debugging`, add a failing automated test, implement the smallest fix, rerun the targeted test and `pnpm verify`, then commit with the required co-author trailer. If all live steps pass, create no verification-only code commit.

---

### Task 5: Converge with the required judge loop

**Files:**
- Create: `docs/judge-loop-portal-admin.md`
- Modify: only files implicated by accepted findings.

**Interfaces:**
- Consumes: verified implementation diff against `origin/main` and the approved design.
- Produces: at most three rounds of independent findings with an explicit disposition for every item.

- [ ] **Step 1: Invoke the judge-loop skill**

Run `judge-loop` against the complete diff with suffix `-portal-admin` and a hard maximum of three rounds. Ask judges to challenge product completeness, security/tenancy, architecture, and simplicity.

- [ ] **Step 2: Record every disposition**

Create `docs/judge-loop-portal-admin.md` with one row per finding:

```md
| Round | Judge | Finding | Disposition | Evidence |
|---|---|---|---|---|
```

Use only `Adopted`, `Rejected`, or `Already satisfied`. Every rejection includes the concrete conflict with the approved scope, observed behavior, or repository rule.

- [ ] **Step 3: Apply accepted findings with TDD**

For each accepted behavior/correctness finding: write and run the failing test, implement the minimal fix, rerun targeted tests. For documentation-only findings, edit the owning mapped document rather than expanding `CLAUDE.md`.

- [ ] **Step 4: Re-run full verification after the final round**

Run:

```bash
pnpm verify
git diff --check
git status --short
```

Expected: verify exits 0, no whitespace errors, and only intentional judge-loop changes remain.

- [ ] **Step 5: Commit the disposition log and adopted fixes**

```bash
git add -A
git commit -m "refactor: adopt final portal admin judge findings" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

Because the worktree is clean at the start of the judge loop, `git add -A` stages only the disposition log and accepted finding changes.

---

### Task 6: Correct PR #73, resolve reviews, and prove green CI

**Files:**
- GitHub PR #73 metadata and review threads; no merge.

**Interfaces:**
- Consumes: clean verified branch, live evidence, and judge dispositions.
- Produces: pushed branch, accurate decision-record PR body, resolved inline AI threads, green CI, final lane report.

- [ ] **Step 1: Verify branch state before publishing**

Run:

```bash
git status --short --branch
git log --oneline origin/main..HEAD
git diff --check origin/main...HEAD
```

Expected: clean worktree and an append-only commit chain containing the merge commit.

- [ ] **Step 2: Push the branch**

Run:

```bash
git push origin feat/portal-admin-depth
```

- [ ] **Step 3: Replace the incorrect PR body with the lane decision record**

Write the observed decision record to `/tmp/pr-73-body.md`, then run:

```bash
gh pr edit 73 --body-file /tmp/pr-73-body.md
```

The body records:

- portal form builder and task attachment outcome;
- custom-status CRUD/assignment outcome;
- effective-subject preview design and why the cookie is non-authoritative;
- central 403 mutation boundary and unchanged-data evidence;
- merge-conflict decision to retain main's `serializeCookie` API;
- atomic first-response decision;
- exact test count, live steps, and judge dispositions;
- explicit **DO NOT MERGE** instruction;
- final line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

Delete the current unrelated reminder/announcement/provisioning body rather than appending to it.

- [ ] **Step 4: Request and process code review**

Invoke `superpowers:requesting-code-review`, then inspect GitHub reviews and inline threads. For each AI-review thread:

1. Verify the claim against code and tests.
2. If valid, use `superpowers:receiving-code-review`, add a failing test, fix, commit, push, and rerun affected checks.
3. If invalid, reply with concrete evidence.
4. Resolve the thread through the GitHub API.

Continue until the query for unresolved review threads returns zero.

- [ ] **Step 5: Wait for green CI without merging**

Run:

```bash
gh pr checks 73 --watch
```

If a check fails, inspect its log, invoke `superpowers:systematic-debugging`, fix with TDD, push, and watch the replacement run. Completion requires every required check green.

- [ ] **Step 6: Print the complete lane report**

The final user-facing message contains:

- PR number and URL;
- CI state and check names;
- per-fix evidence for forms, statuses, preview security/read parity, atomic form response, and both-direction tenancy;
- live fresh-org evidence;
- judge findings and dispositions by round;
- inline AI-review thread count resolved;
- explicit statement that PR #73 remains unmerged.
