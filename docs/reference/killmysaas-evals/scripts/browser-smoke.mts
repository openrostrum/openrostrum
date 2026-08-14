/**
 * Offline smoke test of the Playwright browser layer — no API key needed.
 * Verifies: navigate, ref tagging, fill, select, file upload, click,
 * confirmation detection, and screenshot capture against a local page.
 *
 *   pnpm run smoke
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { BrowserSession } from "../src/browser.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), "sbek-smoke-"));

const targetUrl = "file://" + path.join(here, "smoke.html");
// Same origin computation the harness uses (file:// origins resolve to "null").
const b = new BrowserSession(evidence, true, new URL(targetUrl).origin);
await b.start();

try {
  const snap1 = await b.navigate(targetUrl);

  const titleRef = snap1.match(/\[(e\d+)\] <input[^>]*> Your talk title/)?.[1];
  const selectRef = snap1.match(/\[(e\d+)\] <select/)?.[1];
  const fileRef = snap1.match(/\[(e\d+)\] <input type=file/)?.[1];
  const btnRef = snap1.match(/\[(e\d+)\] <button[^>]*> Submit proposal/)?.[1];
  if (!titleRef || !selectRef || !fileRef || !btnRef) {
    console.error(snap1);
    throw new Error("ref extraction failed — snapshot format changed?");
  }

  console.log(await b.fill(titleRef, "Taming 40-Minute CI"));
  console.log(await b.select(selectRef, "AI Engineering"));
  console.log(await b.upload(fileRef, path.resolve(here, "..", "fixtures", "slides.pdf")));
  await b.click(btnRef);

  const after = await b.snapshot();
  const confirmed = after.includes("Submission received: Taming 40-Minute CI");

  // Drag-and-drop: agenda builders place sessions this way.
  const cardRef = after.match(/\[(e\d+)\] <div[^>]*> SESS-1 Taming 40-Minute CI/)?.[1];
  const slotRef = after.match(/\[(e\d+)\] <div[^>]*> Main Stage 10:00 \(empty slot\)/)?.[1];
  if (!cardRef || !slotRef) {
    console.error(after);
    throw new Error("drag refs not found — is the drag widget rendered/tagged?");
  }
  const afterDrag = await b.drag(cardRef, slotRef);
  const placed = afterDrag.includes("Scheduled: SESS-1 at Main Stage 10:00");
  console.log(`drag ${cardRef} -> ${slotRef}: ${placed ? "session placed" : "NOT placed"}`);
  if (!placed) throw new Error("drag did not place the session");
  // Rich text: inline editable child under a labelled wrapper.
  const snap2 = await b.snapshot();
  const wrapRef = snap2.match(/\[(e\d+)\][^\n]*placeholder abstract/)?.[1];
  if (!wrapRef) { console.error(snap2); throw new Error("inline editor ref not found"); }
  console.log(await b.fill(wrapRef, "Inline abstract text"));
  const afterInline = await b.snapshot();
  if (!afterInline.includes("INLINE:Inline abstract text")) throw new Error("inline rich-text fill failed");
  console.log("inline rich-text: OK");

  // Rich text: TinyMCE-style editable body inside an iframe.
  const frameRef = afterInline.match(/\[(e\d+)\] <richtext>/)?.[1];
  if (!frameRef) { console.error(afterInline.slice(-1500)); throw new Error("editor iframe not surfaced in snapshot"); }
  console.log(await b.fill(frameRef, "Iframe abstract text"));
  const afterFrame = await b.snapshot();
  if (!afterFrame.includes("IFRAME:Iframe abstract text")) throw new Error("iframe rich-text fill failed");
  console.log("iframe rich-text: OK");

  // ---------------------------------------------------------------------
  // Custom combobox (react-select / headlessui / radix shape): a div trigger
  // whose options are portalled to <body> and only exist once it is opened.
  // selectOption() cannot touch it, so the field used to read as unsupported.
  // ---------------------------------------------------------------------
  let snap = await b.snapshot();
  const comboRef = snap.match(/\[(e\d+)\][^\n]*Select a track/)?.[1];
  if (!comboRef) { console.error(snap); throw new Error("custom combobox not surfaced in snapshot"); }
  if (!/\[e\d+\] <div dropdown> Select a track/.test(snap)) {
    throw new Error("custom combobox not flagged as a dropdown in the element list");
  }
  console.log(await b.select(comboRef, "Platform & Infra"));
  if (!(await b.snapshot()).includes("TRACK:Platform & Infra")) {
    throw new Error("custom combobox selection did not register");
  }
  // A miss must report the options that were actually there, not a raw stack.
  const missSnap = await b.snapshot();
  const comboRef2 = missSnap.match(/\[(e\d+)\][^\n]*Platform & Infra/)?.[1]!;
  const miss = await b.select(comboRef2, "Quantum Basketweaving");
  if (!miss.startsWith("ERROR") || !miss.includes("AI Engineering")) {
    throw new Error(`combobox miss should list real options, got: ${miss}`);
  }
  await b.press("Escape");
  console.log("custom combobox: OK");

  // ---------------------------------------------------------------------
  // Date / time inputs: human wording must be normalised, and a read-only
  // field must be clicked (to open its picker) instead of typed into.
  // ---------------------------------------------------------------------
  snap = await b.snapshot();
  const dateRef = snap.match(/\[(e\d+)\] <input type=date>/)?.[1];
  const timeRef = snap.match(/\[(e\d+)\] <input type=time>/)?.[1];
  if (!dateRef || !timeRef) { console.error(snap); throw new Error("date/time inputs not found"); }
  console.log(await b.fill(dateRef, "March 5, 2026"));
  console.log(await b.fill(timeRef, "9:30 AM"));
  const afterDates = await b.snapshot();
  if (!afterDates.includes("DT:2026-03-05 09:30")) {
    throw new Error("date/time normalization failed — expected DT:2026-03-05 09:30");
  }
  const roRef = afterDates.match(/\[(e\d+)\] <input[^>]*\breadonly\b[^>]*> Select deadline/)?.[1];
  if (!roRef) { console.error(afterDates); throw new Error("read-only field not flagged 'readonly' in the element list"); }
  const afterRo = await b.fill(roRef, "2026-04-02");
  if (!/NOTE: .*read-only/.test(afterRo)) {
    throw new Error(`read-only fill should explain itself, got: ${afterRo.slice(0, 300)}`);
  }
  const dayRef = afterRo.match(/\[(e\d+)\] <button[^>]*> 2026-04-02/)?.[1];
  if (!dayRef) { console.error(afterRo); throw new Error("picker did not open on read-only fill"); }
  if (!(await b.click(dayRef)).includes("DEADLINE:2026-04-02")) {
    throw new Error("picker day click did not set the deadline");
  }
  console.log("date/time + read-only picker: OK");

  // ---------------------------------------------------------------------
  // Same-origin iframe embed (the public-widgets feature area ships as one).
  // Its controls are invisible to a top-level DOM query.
  // ---------------------------------------------------------------------
  snap = await b.snapshot();
  const favRef = snap.match(/\[(e\d+)\][^\n]*Add to my schedule — in iframe #embed/)?.[1];
  const qRef = snap.match(/\[(e\d+)\][^\n]*Search sessions — in iframe #embed/)?.[1];
  if (!favRef || !qRef) { console.error(snap); throw new Error("iframe embed controls not surfaced"); }
  if (!snap.includes("--- content of iframe #embed ---")) {
    throw new Error("iframe content missing from the page outline");
  }
  console.log(await b.fill(qRef, "keynote"));
  await b.click(favRef);
  if (!(await b.snapshot()).includes("Added to schedule")) {
    throw new Error("click inside iframe did not take effect");
  }
  console.log("same-origin iframe: OK");

  // ---------------------------------------------------------------------
  // Shadow DOM: the aria outline already showed these (the a11y tree pierces
  // shadow roots) but no ref existed, so the agent could see the feature and
  // not touch it — the worst possible failure shape.
  // ---------------------------------------------------------------------
  snap = await b.snapshot();
  const noteRef = snap.match(/\[(e\d+)\][^\n]*Reviewer note/)?.[1];
  const approveRef = snap.match(/\[(e\d+)\][^\n]*Approve speaker/)?.[1];
  if (!noteRef || !approveRef) { console.error(snap); throw new Error("shadow-DOM controls have no refs"); }
  console.log(await b.fill(noteRef, "strong track record"));
  if (!(await b.click(approveRef)).includes("SHADOW:approved strong track record")) {
    throw new Error("shadow-DOM fill/click did not take effect");
  }
  console.log("shadow DOM: OK");

  // ---------------------------------------------------------------------
  // WRONG-ELEMENT CLICKS. A cursor:pointer list container wrapping
  // cursor:pointer cards used to be listed FIRST, labelled by its first
  // card's text — and clicking it hit the container's centre, i.e. a
  // different row. Acting confidently on the wrong object is the worst
  // failure this harness can produce.
  // ---------------------------------------------------------------------
  snap = await b.snapshot();
  const elemsOf = (s: string) => s.slice(s.indexOf("INTERACTIVE ELEMENTS"));
  const groupLines = elemsOf(snap).split("\n").filter((l) => /Review Group/.test(l));
  if (groupLines.length !== 3) {
    console.error(groupLines.join("\n"));
    throw new Error(`expected exactly 3 refs for 3 group cards, got ${groupLines.length} (the list container is still being listed as a clickable)`);
  }
  const engRef = snap.match(/\[(e\d+)\] <div[^>]*> Engineering Review Group/)?.[1];
  if (!engRef) { console.error(snap); throw new Error("Engineering card has no ref"); }
  const afterGroup = await b.click(engRef);
  if (!afterGroup.includes("GROUP:Engineering")) {
    throw new Error(
      `clicking the ref labelled "Engineering Review Group" acted on the wrong element: ${afterGroup.match(/GROUP:\w+/)?.[0] ?? "(nothing)"}`,
    );
  }
  console.log("nested clickable cards: OK (inner card owns the ref, container skipped)");

  // ---------------------------------------------------------------------
  // NAMELESS CONTROLS. Icon-only buttons, Radix switches labelled by a
  // sibling text node, generated radix ids, and 4 identical "Edit" buttons.
  // ---------------------------------------------------------------------
  snap = await b.snapshot();
  const wants: [RegExp, string][] = [
    [/\[e\d+\] <button[^>]*> \(row "Track"\) grip-vertical icon/, 'drag handle -> (row "Track") grip-vertical icon'],
    [/\[e\d+\] <button[^>]*\bchecked\b[^>]*> \(row "Track"\) switch/, 'switch -> (row "Track") switch [checked]'],
    [/\[e\d+\] <button[^>]*> \(row "Level"\) menu/, 'kebab -> (row "Level") menu'],
    [/\[e\d+\] <button[^>]*\bunchecked\b[^>]*> \(row "Level"\) switch/, 'switch -> (row "Level") switch [unchecked]'],
    [/\[e\d+\] <button[^>]*> Publish immediately switch/, "sibling text node -> Publish immediately switch"],
    [/\[e\d+\] <button[^>]*> Notify evaluators switch/, "sibling text node -> Notify evaluators switch"],
    [/\[e\d+\] <button[^>]*> Session actions menu/, "radix-:r7: id -> labelled ancestor"],
    [/\[e\d+\] <button[^>]*> Edit \(row "Ada Testerman"\)/, 'table row -> Edit (row "Ada Testerman")'],
    [/\[e\d+\] <button[^>]*> Edit \(row "Grace Hopper"\)/, 'table row -> Edit (row "Grace Hopper")'],
    [/\[e\d+\] <button[^>]*> Actions \(row "Grace Hopper"\)/, 'table row -> Actions (row "Grace Hopper")'],
    [/\[e\d+\] <input type=checkbox[^>]*\bunchecked\b[^>]*> Select Ada Testerman/, "row checkbox -> unchecked flag"],
  ];
  for (const [re, what] of wants) {
    if (!re.test(snap)) { console.error(elemsOf(snap)); throw new Error(`nameless-control fix missing: ${what}`); }
  }
  if (/\[e\d+\] <button[^>]*>\s*$/m.test(snap)) {
    console.error(elemsOf(snap));
    throw new Error("some control was still listed with an EMPTY label");
  }
  console.log(`synthesized labels: OK (${wants.length} shapes)`);

  // ---------------------------------------------------------------------
  // DATE PICKER TRIGGER: aria-haspopup="dialog" must count as a dropdown,
  // and duplicate day text ("31" in two months) must be told apart by
  // aria-label.
  // ---------------------------------------------------------------------
  snap = await b.snapshot();
  const dpRef = snap.match(/\[(e\d+)\] <button[^>]*\bdropdown\b[^>]*> August 9th, 2026 at 8:00 PM/)?.[1];
  if (!dpRef) { console.error(elemsOf(snap)); throw new Error("date-picker trigger not flagged as a dropdown"); }
  const afterDp = await b.click(dpRef);
  if (!/\[e\d+\] <button[^>]*> July 31st, 2026/.test(afterDp) || !/\[e\d+\] <button[^>]*> August 31st, 2026/.test(afterDp)) {
    console.error(elemsOf(afterDp));
    throw new Error("day cells were not distinguished by aria-label (both read as '31')");
  }
  const dayRef2 = afterDp.match(/\[(e\d+)\] <button[^>]*> August 1st, 2026/)?.[1];
  if (!dayRef2) { console.error(elemsOf(afterDp)); throw new Error("day cell ref not found"); }
  if (!(await b.click(dayRef2)).includes("DPDAY:August 1st, 2026")) {
    throw new Error("day click did not register");
  }
  console.log("date picker trigger + day labels: OK");

  // ---------------------------------------------------------------------
  // CLICK-TO-EDIT: the value renders as a <button>; the input only exists
  // after a click. fill() used to answer "not an editable field".
  // ---------------------------------------------------------------------
  snap = await b.snapshot();
  const c2eRef = snap.match(/\[(e\d+)\] <button[^>]*> Chief AI Officer/)?.[1];
  if (!c2eRef) { console.error(elemsOf(snap)); throw new Error("click-to-edit field not surfaced"); }
  const c2eRes = await b.fill(c2eRef, "Head of DevRel");
  if (c2eRes.startsWith("ERROR") || !/click-to-edit/.test(c2eRes)) {
    throw new Error(`click-to-edit fill failed: ${c2eRes.slice(0, 300)}`);
  }
  if (!(await b.snapshot()).includes("TITLE:Head of DevRel")) {
    throw new Error("click-to-edit fill did not reach the revealed input");
  }
  console.log("click-to-edit field: OK");

  // ---------------------------------------------------------------------
  // REF BUDGET: sidebar chrome (link + duplicate <span> + repeated
  // "Pin to top" per item) must collapse, with every destination still
  // reachable exactly once.
  // ---------------------------------------------------------------------
  snap = await b.snapshot();
  const elems = elemsOf(snap);
  const countOf = (re: RegExp) => (elems.match(re) ?? []).length;
  if (countOf(/> Pin to top\b/g) !== 1) {
    console.error(elems);
    throw new Error(`"Pin to top" is listed ${countOf(/> Pin to top\b/g)} times; repeated nav chrome was not collapsed`);
  }
  for (const dest of ["Speaker CRM", "Agenda builder", "Sponsor portal"]) {
    const n = countOf(new RegExp(`\\[e\\d+\\] <a> ${dest}$`, "gm"));
    if (n !== 1) {
      console.error(elems);
      throw new Error(`nav destination "${dest}" is listed ${n} times (want exactly 1)`);
    }
  }
  if (/\[e\d+\] <span[^>]*> (Speaker CRM|Agenda builder|Sponsor portal)$/m.test(elems)) {
    console.error(elems);
    throw new Error("duplicate <span> wrappers inside listed links are still taking refs");
  }
  const hiddenNote = elems.match(/\(\+(\d+) redundant refs hidden/);
  if (!hiddenNote || Number(hiddenNote[1]) < 8) {
    throw new Error(`expected the collapsed-chrome summary to account for the hidden refs, got: ${hiddenNote?.[0] ?? "(no summary)"}`);
  }
  console.log(`nav chrome collapse: OK (${hiddenNote[1]} redundant refs hidden, 3 destinations + 1 Pin-to-top kept)`);

  // ---------------------------------------------------------------------
  // NESTED UPLOAD PICKER: no filechooser event fires and the real input is
  // 0x0/opacity:0, so upload() used to report the product cannot accept
  // files at all. An unrelated file input exists earlier on the page, so
  // "first file input on the page" is not an acceptable answer either.
  // ---------------------------------------------------------------------
  snap = await b.snapshot();
  const fspRef = snap.match(/\[(e\d+)\] <button[^>]*> Upload Files/)?.[1];
  if (!fspRef) { console.error(elemsOf(snap)); throw new Error("Upload Files button not surfaced"); }
  const fspRes = await b.upload(fspRef, path.resolve(here, "..", "fixtures", "slides.pdf"));
  if (fspRes.startsWith("ERROR")) throw new Error(`nested-picker upload failed: ${fspRes}`);
  if (!(await b.snapshot()).includes("FSP:slides.pdf")) {
    throw new Error(`file went somewhere else — the nested picker's input never received it (${fspRes.slice(0, 200)})`);
  }
  console.log("nested upload picker: OK");

  // ---------------------------------------------------------------------
  // RADIX SHEET: role="dialog" + a full-viewport fixed overlay, but NO
  // aria-modal / [inert] / aria-hidden. Every classic heuristic missed it,
  // leaving ~150 dead background refs that each cost an 8s timeout.
  // ---------------------------------------------------------------------
  snap = await b.snapshot();
  const openRadix = snap.match(/\[(e\d+)\][^\n]*Manage evaluators/)?.[1]!;
  const inSheet = await b.click(openRadix);
  if (!inSheet.includes('MODAL OPEN: "Evaluator settings')) {
    console.error(inSheet.slice(0, 1200));
    throw new Error("Radix-style dialog (no aria-modal, overlay only) was not detected as modal");
  }
  if (/\[e\d+\] <button[^>]*> Submit proposal/.test(inSheet)) {
    throw new Error("background controls are still listed behind the Radix sheet");
  }
  const nameRef = inSheet.match(/\[(e\d+)\][^\n]*Evaluator name/)?.[1];
  const saveSheet = inSheet.match(/\[(e\d+)\][^\n]*Save evaluators/)?.[1];
  if (!nameRef || !saveSheet) { console.error(inSheet); throw new Error("Radix sheet contents not listed"); }
  console.log(await b.fill(nameRef, "Ada Testerman"));
  const afterSheet = await b.click(saveSheet);
  if (!afterSheet.includes("RADIX:Ada Testerman")) throw new Error("Radix sheet save did not take effect");
  if (afterSheet.includes("MODAL OPEN")) throw new Error("Radix modal scoping stuck after the sheet closed");
  console.log("radix sheet (overlay-only modality): OK");

  // A NON-MODAL <dialog> opened with show() must NOT scope the snapshot.
  snap = await b.snapshot();
  const openPlain = snap.match(/\[(e\d+)\][^\n]*Open tips \(non-modal\)/)?.[1]!;
  const withPlain = await b.click(openPlain);
  if (withPlain.includes("MODAL OPEN")) {
    throw new Error("a non-modal <dialog> (show()) was wrongly treated as a modal");
  }
  if (!/\[e\d+\] <button[^>]*> Submit proposal/.test(withPlain)) {
    throw new Error("page controls disappeared for a non-modal dialog");
  }
  const closePlain = withPlain.match(/\[(e\d+)\][^\n]*Close tips/)?.[1]!;
  await b.click(closePlain);
  console.log("non-modal <dialog> stays unscoped: OK");

  // ---------------------------------------------------------------------
  // A full-screen veil with no dialog role (cookie wall / toast / spinner):
  // clicks silently time out after 8s with an error that reads as a broken
  // control. It must be named, and recovery must work.
  // ---------------------------------------------------------------------
  snap = await b.snapshot();
  const veilBtn = snap.match(/\[(e\d+)\][^\n]*Show consent veil/)?.[1]!;
  await b.click(veilBtn);
  snap = await b.snapshot();
  const target = snap.match(/\[(e\d+)\][^\n]*Publish agenda/)?.[1]!;
  const blocked = await b.click(target);
  if (!blocked.startsWith("ERROR") || !blocked.includes("consent-veil")) {
    throw new Error(`blocked click should name the overlay, got: ${blocked.slice(0, 300)}`);
  }
  console.log(`blocked click diagnosed: ${blocked.slice(0, 140)}…`);
  await b.press("Escape");
  snap = await b.snapshot();
  const target2 = snap.match(/\[(e\d+)\][^\n]*Publish agenda/)?.[1]!;
  if (!(await b.click(target2)).includes("PUBLISHED")) {
    throw new Error("click did not succeed after the veil was dismissed");
  }
  console.log("overlay diagnosis + recovery: OK");

  // ---------------------------------------------------------------------
  // Modal: background controls stay in the DOM and look clickable. Listing
  // them sends the agent into 8s timeouts on dead controls.
  // ---------------------------------------------------------------------
  snap = await b.snapshot();
  const openModalRef = snap.match(/\[(e\d+)\][^\n]*Edit session details/)?.[1]!;
  const inModal = await b.click(openModalRef);
  if (!inModal.includes('MODAL OPEN: "Edit session"')) {
    throw new Error("open modal was not announced in the snapshot");
  }
  if (/\[e\d+\] <button[^>]*> Submit proposal/.test(inModal)) {
    throw new Error("background controls are still listed while a modal is open");
  }
  const roomRef = inModal.match(/\[(e\d+)\][^\n]*Room name/)?.[1];
  const saveRef = inModal.match(/\[(e\d+)\][^\n]*Save session details/)?.[1];
  if (!roomRef || !saveRef) { console.error(inModal); throw new Error("modal contents not listed"); }
  console.log(await b.fill(roomRef, "Room 5"));
  const afterSave = await b.click(saveRef);
  if (!afterSave.includes("MODAL:Room 5")) throw new Error("modal save did not take effect");
  if (afterSave.includes("MODAL OPEN")) throw new Error("modal scoping stuck after the dialog closed");
  if (!/\[e\d+\] <button[^>]*> Submit proposal/.test(afterSave)) {
    throw new Error("page controls did not come back after the modal closed");
  }
  console.log("modal scoping: OK");

  // ---------------------------------------------------------------------
  // Inner scroll container with lazy loading: the window scrollbar does not
  // move it, so the list looks permanently short. Runs last because it adds
  // ~36 rows to every later snapshot.
  // ---------------------------------------------------------------------
  snap = await b.snapshot();
  if (snap.includes("SESSION-30")) throw new Error("smoke page pre-loaded too many rows to test lazy loading");
  const listRef = snap.match(/\[(e\d+)\] <div scrollable>/)?.[1];
  if (!listRef) { console.error(snap); throw new Error("scroll container not surfaced as a ref"); }
  if (!/\[e\d+\] <div scrollable> \(container\)/.test(snap)) {
    console.error(elemsOf(snap));
    throw new Error("a ref wrapping many other listed refs was not marked '(container)'");
  }
  for (let i = 0; i < 6; i++) console.log(await b.scroll("down", listRef));
  if (!(await b.snapshot()).includes("SESSION-30")) {
    throw new Error("scrolling the container did not load more rows");
  }
  console.log("inner scroll container: OK");

  const shot = await b.screenshot("smoke-final", false);
  console.log(`screenshot: ${shot.relPath} (${shot.base64.length} b64 chars)`);
  if (!confirmed) throw new Error("confirmation text not found in snapshot");
  console.log(
    "SMOKE OK: navigate/fill/select/upload/click/drag/screenshot, rich text, custom dropdowns, " +
      "date-time pickers, iframes, shadow DOM, inner scroll containers, overlays and modals, plus " +
      "nested clickable cards, Radix overlay-only dialogs, synthesized labels for nameless controls, " +
      "nested upload pickers, nav-chrome collapse, date-picker triggers and click-to-edit fields",
  );
} finally {
  await b.stop();
  fs.rmSync(evidence, { recursive: true, force: true });
}
