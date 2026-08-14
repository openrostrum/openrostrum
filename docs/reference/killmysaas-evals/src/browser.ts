import fs from "node:fs";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Frame,
  type Locator,
  type Page,
} from "playwright";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "9:30 AM" | "14:05" | "March 5, 2026 9:30am" -> {h, m}. */
function parseClock(text: string): { h: number; m: number } | null {
  const t = text.trim();
  let m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i.exec(t);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ap = m[3] ? m[3].toLowerCase().replace(/\./g, "") : "";
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return h > 23 || min > 59 ? null : { h, m: min };
  }
  m = /^(\d{1,2})\s*([ap]\.?m\.?)$/i.exec(t);
  if (m) {
    let h = Number(m[1]);
    const ap = m[2].toLowerCase().replace(/\./g, "");
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return h > 23 ? null : { h, m: 0 };
  }
  return null;
}

function parseCalendarDate(text: string): Date | null {
  const t = text.trim();
  // Parse ISO by hand: `new Date("2026-03-05")` is UTC midnight, which slides
  // to the previous day for anyone west of Greenwich.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (us) {
    const d = new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

const TEMPORAL_FORMATS: Record<string, string> = {
  date: "YYYY-MM-DD",
  time: "HH:MM (24-hour)",
  "datetime-local": "YYYY-MM-DDTHH:MM",
  month: "YYYY-MM",
  week: "YYYY-Www",
};

/**
 * Temporal inputs only accept one exact wire format; a human-shaped value like
 * "March 5, 2026" makes Playwright's fill() throw "Malformed value". Agenda and
 * CFP-deadline steps are full of those, and the raw error reads as "this app
 * has no date field", so normalise before filling.
 */
function normalizeTemporal(type: string, text: string): string | null {
  const t = text.trim();
  if (type === "time") {
    const c = parseClock(t);
    return c ? `${pad2(c.h)}:${pad2(c.m)}` : null;
  }
  const d = parseCalendarDate(t);
  if (!d) return null;
  const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (type === "date") return ymd;
  if (type === "month") return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  if (type === "datetime-local") {
    const c = parseClock(t) ?? { h: d.getHours(), m: d.getMinutes() };
    return `${ymd}T${pad2(c.h)}:${pad2(c.m)}`;
  }
  if (type === "week") {
    const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7) + 3);
    const firstThu = new Date(dt.getFullYear(), 0, 4);
    firstThu.setDate(firstThu.getDate() - ((firstThu.getDay() + 6) % 7) + 3);
    const week = 1 + Math.round((dt.getTime() - firstThu.getTime()) / (7 * 86_400_000));
    return `${dt.getFullYear()}-W${pad2(week)}`;
  }
  return null;
}

type RawEl = { ref: string; tag: string; type: string; label: string; flags: string[] };
type TaggedEl = RawEl & { frameLabel: string };

/**
 * Thin Playwright wrapper the agent loop drives. Interactive elements are
 * tagged with data-sbek-ref attributes on every snapshot so the model can
 * address them by stable short refs (e1, e2, ...) instead of guessing CSS
 * selectors. Refs are re-assigned on each snapshot.
 *
 * Containment: the session is pinned to the target origin. Off-origin
 * navigations (redirects, external links, popups) are detected after every
 * action and rolled back.
 */
export class BrowserSession {
  private browser!: Browser;
  private context!: BrowserContext;
  page!: Page;
  private refCounter = 0;
  private shotCounter = 0;
  /** Events (dialogs, popups, origin blocks) surfaced in the next tool result. */
  private pendingNotes: string[] = [];
  /** ref -> iframe-hosted rich-text editor (TinyMCE and friends). */
  private frameEditors = new Map<string, Frame>();
  /**
   * ref -> the frame that owns it. Refs living in a child iframe cannot be
   * resolved from the main frame, so every lookup has to go through here.
   */
  private refFrames = new Map<string, Frame>();

  constructor(
    private readonly evidenceDir: string,
    private readonly headless: boolean,
    private readonly targetOrigin: string,
    /** Playwright storageState file to restore (pre-authenticated persona). */
    private readonly storageStatePath?: string,
  ) {}

  async start(): Promise<void> {
    this.browser = await chromium.launch({ headless: this.headless });
    try {
      const useState = this.storageStatePath && fs.existsSync(this.storageStatePath);
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        // Consistent UA so clones don't serve mobile layouts.
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 sbek-eval/0.1",
        ...(useState ? { storageState: this.storageStatePath } : {}),
      });
      this.page = await this.context.newPage();
      this.page.setDefaultTimeout(10_000);
      this.attachPageHandlers(this.page);

      // Popups / new tabs: adopt same-origin pages, close off-origin ones.
      this.context.on("page", async (newPage) => {
        try {
          await newPage.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
          const url = newPage.url();
          if (this.isOnTarget(url)) {
            this.pendingNotes.push(`A new tab opened at ${url}; the session switched to it.`);
            this.page = newPage;
            this.page.setDefaultTimeout(10_000);
            this.attachPageHandlers(this.page);
          } else {
            this.pendingNotes.push(`A new tab opened at off-target URL ${url} and was closed.`);
            await newPage.close().catch(() => {});
          }
        } catch {
          /* best-effort */
        }
      });

      fs.mkdirSync(path.join(this.evidenceDir, "screenshots"), { recursive: true });
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  private attachPageHandlers(page: Page): void {
    page.on("dialog", async (dialog) => {
      this.pendingNotes.push(
        `Native ${dialog.type()} dialog appeared with message "${dialog.message()}" — it was accepted.`,
      );
      await dialog.accept().catch(() => {});
    });
  }

  /**
   * Containment check. Sibling subdomains of the same registrable domain count
   * as on-target: real products split across app./appv2./admin./www. hosts, and
   * pinning to one exact origin strands the agent on a shell it cannot leave.
   * Anything on a different registrable domain is still refused.
   */
  /** Public form of the containment rule, so callers don't re-implement it. */
  isAllowedUrl(url: string): boolean {
    return this.isOnTarget(url);
  }

  private isOnTarget(url: string): boolean {
    if (url === "about:blank" || url.startsWith("data:")) return true;
    try {
      const u = new URL(url);
      // Exact-origin match first: this is the only check that works for
      // opaque origins such as file:// (whose origin is the string "null"
      // and is not itself a parseable URL).
      if (u.origin === this.targetOrigin) return true;
      let t: URL;
      try {
        t = new URL(this.targetOrigin);
      } catch {
        return false; // opaque target origin: exact match was the only option
      }
      if (u.protocol !== t.protocol) return false;
      const base = (h: string) => h.split(".").slice(-2).join(".");
      return base(u.hostname) === base(t.hostname) && base(t.hostname).includes(".");
    } catch {
      return false;
    }
  }

  /**
   * Post-action containment check: if any action (redirect, link click, form
   * submit) landed off the target origin, roll back and tell the model.
   */
  private async enforceOrigin(): Promise<string | null> {
    const url = this.page.url();
    if (this.isOnTarget(url)) return null;
    const blocked = `BLOCKED: the page navigated off-target to ${url}. Stay on ${this.targetOrigin}.`;
    const back = await this.page
      .goBack({ waitUntil: "domcontentloaded", timeout: 8_000 })
      .catch(() => null);
    if (!back || !this.isOnTarget(this.page.url())) {
      await this.page
        .goto(this.targetOrigin, { waitUntil: "domcontentloaded", timeout: 15_000 })
        .catch(() => {});
    }
    return `${blocked} The browser was returned to ${this.page.url()}.`;
  }

  private drainNotes(): string {
    if (this.pendingNotes.length === 0) return "";
    const notes = this.pendingNotes.map((n) => `NOTE: ${n}`).join("\n");
    this.pendingNotes = [];
    return notes + "\n\n";
  }

  /** Persist cookies/localStorage so a persona's login survives into later scenarios. */
  async saveStorageState(filePath: string): Promise<void> {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    await this.context.storageState({ path: filePath });
  }

  async stop(): Promise<void> {
    await this.browser?.close().catch(() => {});
  }

  async navigate(url: string): Promise<string> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await this.page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    return this.snapshot();
  }

  /**
   * Text snapshot of the current page: url, title, aria outline, and an
   * indexed list of interactive elements. This is the agent's primary sense.
   */
  async snapshot(): Promise<string> {
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
    const originMsg = await this.enforceOrigin();
    const url = this.page.url();
    const title = await this.page.title().catch(() => "");

    const { entries, modalLabel, frameOutlines, hidden } = await this.tagInteractiveElements();

    // With a modal open, the aria outline of <body> is mostly unreachable
    // background; scope it to the dialog so the outline matches the refs.
    let aria = "";
    try {
      const scope = modalLabel
        ? this.page.locator('[data-sbek-modal="1"]').first()
        : this.page.locator("body");
      aria = await scope.ariaSnapshot({ timeout: 5_000 });
    } catch {
      try {
        aria = await this.page.locator("body").ariaSnapshot({ timeout: 5_000 });
      } catch {
        aria = "(aria snapshot unavailable)";
      }
    }
    // Cap the outline so a giant page doesn't blow up the context window.
    const MAX_ARIA = 12_000;
    if (aria.length > MAX_ARIA) aria = aria.slice(0, MAX_ARIA) + "\n... (truncated)";
    for (const fo of frameOutlines) {
      aria += `\n\n--- content of ${fo.label} ---\n${fo.aria.slice(0, 2_500)}`;
    }

    const lines = entries.map((el) => {
      const attrs = (el.type ? ` type=${el.type}` : "") + (el.flags.length ? ` ${el.flags.join(" ")}` : "");
      return `[${el.ref}] <${el.tag}${attrs}> ${el.label}${el.frameLabel ? ` — ${el.frameLabel}` : ""}`;
    });
    let elementList = lines.join("\n");
    const MAX_ELEMS = 10_000;
    if (elementList.length > MAX_ELEMS) elementList = elementList.slice(0, MAX_ELEMS) + "\n... (truncated)";
    // Sidebar chrome routinely accounts for ~40% of a snapshot's refs (every
    // nav item repeats as link + duplicate <span> + a per-item "Pin to top"),
    // which is how a screen hits the ref cap and loses MAIN CONTENT. Those
    // repeats are collapsed; say so, so the model does not read the shorter
    // list as a missing menu.
    if (hidden > 0) {
      elementList +=
        `\n(+${hidden} redundant refs hidden: repeated sidebar/nav chrome and <span> wrappers of controls already listed above. Every navigation destination is still listed exactly once.)`;
    }

    const editorLines = await this.tagFrameEditors();
    if (editorLines.length) {
      elementList = (elementList ? elementList + "\n" : "") + editorLines.join("\n");
    }

    return [
      this.drainNotes() + (originMsg ? originMsg + "\n" : "") + `URL: ${url}`,
      `TITLE: ${title}`,
      ``,
      `PAGE OUTLINE (aria):`,
      aria,
      ``,
      ...(modalLabel
        ? [
            `MODAL OPEN: "${modalLabel}" — a modal dialog is covering the page, so ONLY its contents are listed below. Everything behind it is inert and cannot be clicked. Save/close/cancel inside the dialog (or press Escape) to reach the rest of the page.`,
            ``,
          ]
        : []),
      `INTERACTIVE ELEMENTS (use these refs with click/fill/select):`,
      elementList || "(none found)",
    ].join("\n");
  }

  /**
   * Tag every interactive element the agent could act on, across the main
   * frame and every reachable same-origin child frame, and return one flat
   * list of refs.
   */
  private async tagInteractiveElements(): Promise<{
    entries: TaggedEl[];
    modalLabel: string | null;
    frameOutlines: { label: string; aria: string }[];
    hidden: number;
  }> {
    this.refFrames.clear();
    const entries: TaggedEl[] = [];
    const frameOutlines: { label: string; aria: string }[] = [];
    let hidden = 0;

    let main = await this.collectFrame(this.page.mainFrame(), this.refCounter, true);
    // Safety valve: if scoping to a modal leaves the agent with nothing to
    // click (an aria-modal container that is really an inline panel, or a
    // dialog whose controls are all in a portal outside it), the agent would
    // be stranded. Re-run unscoped rather than show an empty page.
    if (main.modalLabel && main.out.length === 0) {
      main = await this.collectFrame(this.page.mainFrame(), this.refCounter, false);
      main.modalLabel = null;
    }
    this.refCounter = main.last;
    hidden += main.hidden;
    for (const el of main.out) entries.push({ ...el, frameLabel: "" });

    // Same-origin child frames: embedded widgets ("add this agenda to your
    // site"), payment/booking panes and legacy admin screens all live in one,
    // and a top-level DOM query cannot see a single control inside them.
    let frames = 0;
    for (const frame of this.page.frames()) {
      if (frame === this.page.mainFrame()) continue;
      if (frames >= 5) break;
      let label = "";
      try {
        const fe = await frame.frameElement();
        if (main.modalLabel) {
          const insideModal = await fe
            .evaluate((el) => !!(el as HTMLElement).closest('[data-sbek-modal="1"]'))
            .catch(() => false);
          if (!insideModal) continue;
        }
        label = await fe
          .evaluate((el) => {
            const e = el as HTMLIFrameElement;
            const id = e.id ? `#${e.id}` : "";
            const nm = e.name || e.title || "";
            return `iframe ${id || nm || (e.getAttribute("src") || "").slice(-40) || "(inline)"}`;
          })
          .catch(() => "iframe");
      } catch {
        continue; // detached or cross-origin: frameElement() is unavailable
      }

      const res = await this.collectFrame(frame, this.refCounter, false);
      this.refCounter = res.last;
      hidden += res.hidden;
      if (res.out.length === 0) continue;
      frames += 1;
      for (const el of res.out) {
        this.refFrames.set(el.ref, frame);
        entries.push({ ...el, frameLabel: `in ${label}` });
      }
      const fAria = await frame
        .locator("body")
        .ariaSnapshot({ timeout: 3_000 })
        .catch(() => "");
      if (fAria) frameOutlines.push({ label, aria: fAria });
    }

    return { entries, modalLabel: main.modalLabel, frameOutlines, hidden };
  }

  private async collectFrame(
    frame: Frame,
    base: number,
    detectModal: boolean,
  ): Promise<{ out: RawEl[]; last: number; modalLabel: string | null; hidden: number }> {
    const work = frame.evaluate((args: { baseCount: number; detectModal: boolean }) => {
      const baseCount = args.baseCount;
      // NB: no named helper functions (or named const-arrows) in here — the
      // bundler's keepNames shim (__name) does not exist in the page context
      // and would throw. Everything below is written as inline loops.

      // Pass 0: walk the whole element tree INCLUDING open shadow roots.
      // querySelectorAll stops at a shadow boundary, so a design system built
      // on web components reads as a blank page: the aria outline still shows
      // "button Approve speaker" (the a11y tree does pierce shadow DOM) while
      // no ref exists for it, i.e. the agent can see the feature and not touch
      // it. Bound total elements EXAMINED so a 20k-row table can't stall us.
      const roots: (Document | ShadowRoot)[] = [document];
      const allEls: HTMLElement[] = [];
      let ri = 0;
      while (ri < roots.length && allEls.length < 20000) {
        const list = roots[ri].querySelectorAll<HTMLElement>("*");
        ri += 1;
        for (let k = 0; k < list.length; k++) {
          const el = list[k];
          allEls.push(el);
          if (el.shadowRoot) roots.push(el.shadowRoot);
          if (allEls.length >= 20000) break;
        }
      }
      // Clear markers from prior snapshots. In an SPA, elements that survive
      // navigation (sidebars, headers) keep their old attribute, so a stale
      // ref would silently resolve to the WRONG element — e.g. clicking "Sign
      // out" while intending something else. After clearing, a stale ref
      // resolves to nothing and the tool returns a take-a-new-snapshot error.
      for (let k = 0; k < allEls.length; k++) {
        const el = allEls[k];
        if (el.hasAttribute("data-sbek-ref")) el.removeAttribute("data-sbek-ref");
        if (el.hasAttribute("data-sbek-modal")) el.removeAttribute("data-sbek-modal");
        if (el.hasAttribute("data-sbek-listed")) el.removeAttribute("data-sbek-listed");
      }

      // Pass 0b: is a modal dialog open? If so it owns the interaction
      // surface — every background control is listed-but-unclickable, and the
      // agent burns turns on 8s "intercepts pointer events" timeouts.
      let modalRoot: HTMLElement | null = null;
      let modalLabel: string | null = null;
      if (args.detectModal) {
        // Radix (and most shadcn/Tailwind) Sheets and Dialogs render
        //   <div role="dialog" class="fixed z-50">
        // with aria-modal=null, no [inert], no aria-hidden and
        // body{pointer-events:auto} — EVERY classic modality heuristic misses
        // them, so ~150 background refs stay listed and each click on one
        // burns an 8s pointer-intercept timeout. What they do always render is
        // a full-viewport position:fixed overlay behind the panel
        // (div.fixed.inset-0.z-50.bg-black/50). Treat that as the signal.
        let hasOverlay = false;
        for (let k = 0; k < allEls.length && !hasOverlay; k++) {
          const el = allEls[k];
          const st = window.getComputedStyle(el);
          if (st.position !== "fixed") continue;
          if (st.display === "none" || st.visibility === "hidden") continue;
          if (Number(st.opacity) === 0) continue;
          const z = parseInt(st.zIndex, 10);
          if (!(z >= 40)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < window.innerWidth * 0.9) continue;
          if (r.height < window.innerHeight * 0.9) continue;
          hasOverlay = true;
        }
        for (let k = 0; k < allEls.length; k++) {
          const el = allEls[k];
          let isModal = false;
          try {
            isModal = el.matches(":modal"); // <dialog> opened with showModal()
          } catch (e) {
            isModal = false;
          }
          if (!isModal) {
            // NB: getAttribute("role"), not the implicit role — a <dialog>
            // opened with show() (non-modal by definition) must stay unscoped.
            const role = el.getAttribute("role");
            isModal =
              (role === "dialog" || role === "alertdialog") &&
              (el.getAttribute("aria-modal") === "true" || hasOverlay);
          }
          if (!isModal) continue;
          const st = window.getComputedStyle(el);
          if (st.display === "none" || st.visibility === "hidden") continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          modalRoot = el; // last visible one in document order = topmost
        }
        if (modalRoot) {
          modalRoot.setAttribute("data-sbek-modal", "1");
          const raw =
            modalRoot.getAttribute("aria-label") ||
            modalRoot.getAttribute("title") ||
            (modalRoot.textContent ?? "").trim() ||
            "dialog";
          modalLabel = raw.replace(/\s+/g, " ").slice(0, 70);
        }
      }

      const selector =
        'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="listbox"], [role="option"], [role="treeitem"], [contenteditable="true"], [onclick], [tabindex]:not([tabindex="-1"])';
      const candTags: Record<string, number> = {
        DIV: 1, TR: 1, LI: 1, TD: 1, SPAN: 1, ARTICLE: 1, SECTION: 1,
      };
      const explicit: HTMLElement[] = [];
      // React/Vue rows and cards are frequently plain <div>/<tr> with a
      // synthetic click handler — no href, no button, no onclick attribute —
      // so a selector alone misses them entirely (e.g. an events table whose
      // rows are the only way into an event). Treat cursor:pointer as the
      // clickability signal for those, bounded so big pages stay fast.
      const candidates: HTMLElement[] = [];
      for (let k = 0; k < allEls.length; k++) {
        const el = allEls[k];
        if (el === document.body || el === document.documentElement) continue;
        if (modalRoot && !modalRoot.contains(el)) continue;
        if (el.closest && el.closest("[inert]")) continue;
        let isExp = false;
        try {
          isExp = el.matches(selector);
        } catch (e) {
          isExp = false;
        }
        if (isExp) {
          if (explicit.length < 4000) explicit.push(el);
        } else if (candTags[el.tagName] && candidates.length < 3000) {
          candidates.push(el);
        }
      }

      // Inner scroll containers. Lazy / virtualised lists live inside one, and
      // the window scrollbar does not move them — so "only 12 sessions exist"
      // is really "the container was never scrolled". Surface them as refs the
      // agent can aim the scroll tool at.
      const scrollers: HTMLElement[] = [];
      for (let k = 0; k < allEls.length && scrollers.length < 5; k++) {
        const el = allEls[k];
        if (el === document.body || el === document.documentElement) continue;
        if (modalRoot && !modalRoot.contains(el)) continue;
        if (el.scrollHeight - el.clientHeight <= 24) continue;
        const st = window.getComputedStyle(el);
        if (st.overflowY !== "auto" && st.overflowY !== "scroll") continue;
        const r = el.getBoundingClientRect();
        if (r.width * r.height < 8000) continue;
        scrollers.push(el);
      }

      // Pass 1: reads only (no interleaved writes -> no layout thrashing).
      const visible: HTMLElement[] = [];
      const seen = new Set<HTMLElement>();
      for (const el of explicit) {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (style.visibility === "hidden" || style.display === "none") continue;
        seen.add(el);
        visible.push(el);
        if (visible.length >= 250) break;
      }
      // Mark everything decided so far, so a cursor:pointer wrapper can be
      // told apart from a real target by what it CONTAINS.
      for (const el of visible) el.setAttribute("data-sbek-listed", "1");

      // Candidates are judged in REVERSE document order — a descendant always
      // follows its ancestor, so going backwards means the inner cards are
      // decided (and marked) before the list container that wraps them. This
      // is the whole fix for the worst failure mode in this harness: a
      // cursor:pointer list container was given a ref labelled by its FIRST
      // child's text ("Engineering Review Group Closed v20 Evaluators…"), and
      // clicking that ref clicked the container's centre — which is a
      // different row entirely (it opened the Finance plan). The agent then
      // acted confidently on the wrong object, which scores worse than
      // failing outright.
      const keep = new Set<HTMLElement>();
      for (let k = candidates.length - 1; k >= 0; k--) {
        const el = candidates[k];
        if (seen.has(el)) continue;
        const style = window.getComputedStyle(el);
        if (style.cursor !== "pointer") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (style.visibility === "hidden" || style.display === "none") continue;
        const text = (el.textContent ?? "").trim();
        if (!text || text.length > 200) continue;
        // More than one already-listed clickable inside => this is a
        // container of targets, not a target. Its children are the things to
        // click, and they are already listed.
        if (el.querySelectorAll("[data-sbek-listed]").length > 1) continue;
        el.setAttribute("data-sbek-listed", "1");
        keep.add(el);
      }
      // Re-emit in document order so refs stay reading-order stable.
      for (const el of candidates) {
        if (visible.length >= 250) break;
        if (!keep.has(el)) continue;
        seen.add(el);
        visible.push(el);
      }
      // Scrollers are appended past the cap: there are at most 5 and losing
      // them is what hides the rest of a long list.
      const scrollSet = new Set<HTMLElement>();
      for (const el of scrollers) {
        scrollSet.add(el);
        if (seen.has(el)) continue;
        seen.add(el);
        visible.push(el);
      }
      for (const el of visible) el.setAttribute("data-sbek-listed", "1");

      // Pass 2: writes + label extraction.
      const out: { ref: string; tag: string; type: string; label: string; flags: string[] }[] = [];
      const chromeSeen: Record<string, number> = {};
      let hidden = 0;
      let i = baseCount;
      for (const el of visible) {
        const tagName = el.tagName;
        const role = el.getAttribute("role");
        const haspopup = el.getAttribute("aria-haspopup");

        // ---- redundant <span> wrappers -------------------------------------
        // A nav item routinely triples up as link + inner <span> + a repeated
        // per-item action. The <span> is the same target as its parent and
        // just burns a ref.
        if (tagName === "SPAN") {
          const par = el.parentElement;
          if (par && par.hasAttribute("data-sbek-listed")) {
            const pt = (par.textContent ?? "").replace(/\s+/g, " ").trim();
            const st = (el.textContent ?? "").replace(/\s+/g, " ").trim();
            if (pt === st) {
              hidden += 1;
              continue;
            }
          }
        }

        const labelSource =
          el.getAttribute("aria-label") ||
          (el as HTMLInputElement).placeholder ||
          el.getAttribute("title") ||
          (el.textContent ?? "").trim() ||
          (el as HTMLInputElement).name ||
          el.id ||
          "";
        let label = labelSource.replace(/\s+/g, " ").trim();
        const truncated = label.length > 90;
        if (truncated) label = label.slice(0, 90) + "…";

        // ---- row context ---------------------------------------------------
        // A table of 25 identical `<button>Edit` refs is untargetable; each
        // one has to carry the row it acts on.
        let rowText = "";
        let rowNode: Element | null = null;
        try {
          rowNode = el.closest('tr,[role="row"]');
        } catch (e) {
          rowNode = null;
        }
        if (rowNode) {
          const cells = rowNode.querySelectorAll(
            'td,th,[role="cell"],[role="gridcell"],[role="rowheader"]',
          );
          for (let c = 0; c < cells.length && !rowText; c++) {
            const t = (cells[c].textContent ?? "").replace(/\s+/g, " ").trim();
            if (t) rowText = t.slice(0, 40);
          }
          // Selection checkboxes are usually the best-labelled thing in a row
          // ("Select Ada Testerman"), so borrow that when the cells are bare.
          if (!rowText) {
            const lab = rowNode.querySelector("[aria-label]");
            if (lab) {
              rowText = (lab.getAttribute("aria-label") ?? "")
                .replace(/^\s*select\s+/i, "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 40);
            }
          }
        }

        // ---- nameless controls ---------------------------------------------
        // Icon-only buttons (drag handle / switch / kebab), Radix switches
        // whose label is a sibling text node, and Radix's generated ids all
        // produce empty or meaningless labels — 23 refs reading `<button> `
        // with the thing they act on ("Track", "Level") carrying no ref at
        // all. Edit vs delete then becomes a coin flip. Synthesize a name.
        if (!label || /^radix-:/.test(label) || /^:r[0-9a-z]+:$/.test(label)) {
          let syn = "";
          let anc: Element | null = el.parentElement;
          for (let h = 0; anc && h < 6 && !syn; h++) {
            syn = (anc.getAttribute("aria-label") || anc.getAttribute("title") || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 40);
            anc = anc.parentElement;
          }
          if (!syn) syn = rowText;
          if (!syn) {
            const par = el.parentElement;
            if (par) {
              let sib = "";
              for (let n = 0; n < par.childNodes.length; n++) {
                const cn = par.childNodes[n];
                if (cn === el) continue;
                if (cn.nodeType === 3) {
                  sib += " " + (cn.nodeValue ?? "");
                  continue;
                }
                if (cn.nodeType !== 1) continue;
                const ce = cn as HTMLElement;
                let interactive = false;
                try {
                  interactive = ce.matches(selector) || !!ce.querySelector(selector);
                } catch (e) {
                  interactive = true; // unknown => assume it is another control
                }
                if (interactive) continue;
                sib += " " + (ce.textContent ?? "");
              }
              syn = sib.replace(/\s+/g, " ").trim().slice(0, 40);
            }
          }
          if (!syn) {
            let node: Element | null = el;
            for (let h = 0; node && h < 5 && !syn; h++) {
              let s: Element | null = node.previousElementSibling;
              while (s && !syn) {
                if (/^H[1-6]$/.test(s.tagName)) {
                  syn = (s.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
                }
                s = s.previousElementSibling;
              }
              node = node.parentElement;
            }
          }
          // What KIND of control it is, so three icon buttons in one row do
          // not collapse into three identical refs.
          let hint = "";
          const sv = el.querySelector("svg");
          if (sv) {
            const ti = sv.querySelector("title");
            if (ti) hint = (ti.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
            if (!hint) {
              const cls = (sv.getAttribute("class") ?? "") + " " + (el.getAttribute("class") ?? "");
              const mi = /(?:lucide|icon|fa|bi)-([a-z0-9-]{2,30})/i.exec(cls);
              hint = mi ? mi[1] : (sv.getAttribute("data-icon") ?? "").slice(0, 30);
            }
            if (hint) hint = hint + " icon";
          }
          if (!hint) {
            if (haspopup === "menu" || haspopup === "dialog" || haspopup === "listbox") {
              hint = haspopup;
            } else if (role) {
              hint = role;
            } else {
              hint = tagName.toLowerCase();
            }
          }
          const parts: string[] = [];
          if (rowText) parts.push('(row "' + rowText + '")');
          if (syn && syn !== rowText) parts.push(syn);
          if (hint) parts.push(hint);
          label = parts.join(" ") || "(unlabeled " + tagName.toLowerCase() + ")";
        } else if (rowText && label.toLowerCase().indexOf(rowText.toLowerCase()) < 0) {
          label = label + ' (row "' + rowText + '")';
        }

        // ---- sidebar / nav chrome collapse ----------------------------------
        // Keep every destination reachable exactly once and drop the repeats
        // ("Pin to top" once per item, duplicate labels), so main content is
        // not the thing that gets truncated at the ref cap.
        let chrome: Element | null = null;
        try {
          chrome = el.closest('nav,aside,[role="navigation"],[role="complementary"]');
        } catch (e) {
          chrome = null;
        }
        if (chrome) {
          const href = el.getAttribute("href") ?? "";
          const key = href ? "h:" + href : "l:" + label.toLowerCase();
          if (chromeSeen[key]) {
            hidden += 1;
            continue;
          }
          chromeSeen[key] = 1;
        }

        i += 1;
        const ref = `e${i}`;
        el.setAttribute("data-sbek-ref", ref);
        const flags: string[] = [];
        if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") {
          flags.push("disabled");
        }
        if (el.hasAttribute("readonly") || el.getAttribute("aria-readonly") === "true") {
          flags.push("readonly");
        }
        const inputType = ((el as HTMLInputElement).type ?? "").toLowerCase();
        if (
          role === "switch" ||
          role === "checkbox" ||
          role === "radio" ||
          (tagName === "INPUT" && (inputType === "checkbox" || inputType === "radio"))
        ) {
          const ac = el.getAttribute("aria-checked");
          if (ac === "mixed") flags.push("mixed");
          else if (ac === null) flags.push((el as HTMLInputElement).checked ? "checked" : "unchecked");
          else flags.push(ac === "true" ? "checked" : "unchecked");
        }
        if (
          tagName !== "SELECT" &&
          (role === "combobox" ||
            role === "listbox" ||
            haspopup === "listbox" ||
            haspopup === "menu" ||
            // A date/time trigger is <button aria-haspopup="dialog">August 9th,
            // 2026 at 8:00 PM</button> opening a day-picker popover; without
            // this it read as an ordinary button and the popover was never
            // opened deliberately.
            haspopup === "dialog")
        ) {
          flags.push("dropdown");
        }
        if (scrollSet.has(el)) flags.push("scrollable");
        // A ref that wraps several other listed refs is a region, not a
        // button: clicking its centre hits whichever child happens to sit
        // there. Say so in the label — and note that a 90-char cut hides the
        // fact that the label spans many items.
        const innerListed = el.querySelectorAll("[data-sbek-listed]").length;
        if (innerListed >= 2 || (truncated && innerListed >= 1)) label = "(container) " + label;
        out.push({
          ref,
          tag: tagName.toLowerCase(),
          type: (el as HTMLInputElement).type ?? "",
          label,
          flags,
        });
      }
      for (let k = 0; k < allEls.length; k++) {
        const el = allEls[k];
        if (el.hasAttribute("data-sbek-listed")) el.removeAttribute("data-sbek-listed");
      }
      return { out, last: i, modalLabel, hidden };
    }, { baseCount: base, detectModal });

    // page.evaluate is not covered by setDefaultTimeout; guard against pages
    // whose main thread never yields.
    // Never fail silently: an empty element list looks identical to "this page
    // has no controls", which sends the agent hunting for a feature that is
    // right there. Surface both the error and the timeout as agent-visible notes.
    type Collected = { out: RawEl[]; last: number; modalLabel: string | null; hidden: number };
    let timer: NodeJS.Timeout | undefined;
    const result = await Promise.race<Collected>([
      work.catch((err: any) => {
        this.pendingNotes.push(
          `Element detection failed on this page (${String(err?.message).slice(0, 160)}). The interactive list may be empty or incomplete.`,
        );
        return { out: [] as RawEl[], last: base, modalLabel: null as string | null, hidden: 0 };
      }),
      new Promise<Collected>((resolve) => {
        timer = setTimeout(() => {
          this.pendingNotes.push(
            "Element detection timed out after 15s on this page; the interactive list may be empty or incomplete.",
          );
          resolve({ out: [], last: base, modalLabel: null, hidden: 0 });
        }, 15_000);
      }),
    ]);
    if (timer) clearTimeout(timer);
    return result;
  }

  /**
   * Rich-text editors that render into their own iframe (classic TinyMCE) are
   * invisible to a top-level DOM query, so the agent cannot see the abstract
   * field exists. List each editable frame body as its own ref.
   */
  private async tagFrameEditors(): Promise<string[]> {
    this.frameEditors.clear();
    const lines: string[] = [];
    for (const frame of this.page.frames()) {
      if (frame === this.page.mainFrame()) continue;
      try {
        const editable = await frame
          .evaluate(() => {
            const b = document.body;
            if (!b) return null;
            const ce = b.getAttribute("contenteditable") === "true" ? b : b.querySelector('[contenteditable="true"]');
            if (!ce) return null;
            return { label: (document.title || b.id || b.className || "rich text editor").slice(0, 60) };
          })
          .catch(() => null);
        if (!editable) continue;
        this.refCounter += 1;
        const ref = `e${this.refCounter}`;
        this.frameEditors.set(ref, frame);
        lines.push(`[${ref}] <richtext> ${editable.label} (editor iframe — use fill)`);
      } catch {
        /* cross-origin or detached frame */
      }
    }
    return lines;
  }

  /**
   * Refs are resolved inside the frame that owns them. `page.locator` only
   * searches the main frame, so an embed-widget ref would silently resolve to
   * nothing. (Playwright's CSS engine does pierce open shadow roots, so
   * shadow-DOM refs need no special handling here.)
   */
  private refLocator(ref: string): Locator {
    const frame = this.refFrames.get(ref);
    return (frame ?? this.page.mainFrame()).locator(`[data-sbek-ref="${ref}"]`).first();
  }

  private async refMissing(loc: Locator): Promise<boolean> {
    try {
      return (await loc.count()) === 0;
    } catch {
      return true; // frame detached out from under us
    }
  }

  private stale(ref: string): string {
    return `ERROR: ref ${ref} not found on the current page. Take a new snapshot to get fresh refs.`;
  }

  /**
   * When a click fails, name what is on top of the target. Playwright's raw
   * "intercepts pointer events" timeout is 8 wasted seconds plus an error the
   * model usually reads as "this control is broken", when the real answer is
   * "close the cookie banner / toast / drawer first".
   */
  private async describeClickBlocker(loc: Locator): Promise<string | null> {
    return await loc
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        // Off-screen centre: elementFromPoint would report an unrelated
        // element, so say nothing rather than accuse the wrong overlay.
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null;
        const top = document.elementFromPoint(x, y);
        if (!top || top === el || el.contains(top) || top.contains(el)) return null;
        // Shadow DOM retargets: for a control inside an open shadow root,
        // document.elementFromPoint reports the HOST, which is an ancestor in
        // the flattened tree, not an overlay. Walk the host chain before
        // accusing it of covering anything.
        let node: Node | null = el;
        for (let hop = 0; hop < 10 && node; hop++) {
          const root = node.getRootNode() as ShadowRoot;
          const host = root && root.host ? (root.host as HTMLElement) : null;
          if (!host) break;
          if (host === top || host.contains(top) || top.contains(host)) return null;
          node = host;
        }
        const id = top.id ? `#${top.id}` : "";
        const cn = typeof top.className === "string" ? top.className.trim() : "";
        const cls = cn ? "." + cn.split(/\s+/).slice(0, 2).join(".") : "";
        const txt = (top.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
        return `<${top.tagName.toLowerCase()}${id}${cls}>${txt ? ` "${txt}"` : ""}`;
      })
      .catch(() => null);
  }

  async click(ref: string): Promise<string> {
    const loc = this.refLocator(ref);
    if (await this.refMissing(loc)) return this.stale(ref);
    await loc.scrollIntoViewIfNeeded().catch(() => {});

    // Pre-check: if something is already on top, Playwright would retry for a
    // full 8s and then report an error the model reads as "control broken".
    // Re-check once, so a spinner that is about to clear is not misreported.
    let blocker = await this.describeClickBlocker(loc);
    if (blocker) {
      await this.page.waitForTimeout(700);
      blocker = await this.describeClickBlocker(loc);
    }
    if (!blocker) {
      try {
        await loc.click({ timeout: 8_000 });
      } catch (err: any) {
        blocker = await this.describeClickBlocker(loc);
        if (!blocker) {
          return `ERROR: click on ${ref} failed: ${String(err?.message ?? err).split("\n")[0].slice(0, 200)}`;
        }
      }
    }
    if (blocker) {
      return `ERROR: ${ref} could not be clicked because ${blocker} is covering it — an overlay, modal, cookie banner, toast or loading veil is in the way. Close or dismiss that layer first (press Escape, or click its close/accept control), then take a fresh snapshot and retry. The control itself is not necessarily broken.`;
    }
    await this.page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
    return this.snapshot();
  }

  /**
   * Type into a field. Handles plain inputs, contenteditable, and rich-text
   * editors (TinyMCE/Quill/ProseMirror/Slate) — abstract and description
   * fields are rich text in nearly every product in this category, and a
   * naive fill() reports them as unfillable, which reads as a missing feature.
   */
  async fill(ref: string, text: string): Promise<string> {
    // A rich-text editor living in its own iframe, surfaced by snapshot().
    const frame = this.frameEditors.get(ref);
    if (frame) {
      const body = frame.locator("body");
      await body.click();
      await this.page.keyboard.press("ControlOrMeta+a");
      await this.page.keyboard.press("Delete");
      await body.pressSequentially(text, { delay: 5 });
      return this.drainNotes() + `Filled rich-text editor ${ref} with: ${text.slice(0, 120)}`;
    }

    const loc = this.refLocator(ref);
    if (await this.refMissing(loc)) return this.stale(ref);

    const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
    // A dropdown addressed with fill instead of select: do the right thing
    // rather than erroring — models mix these two up constantly.
    if (tag === "select") return this.select(ref, text);

    if (tag === "input" || tag === "textarea") {
      const meta = await loc
        .evaluate((el) => ({
          type: (el.getAttribute("type") ?? "").toLowerCase(),
          readOnly:
            (el as HTMLInputElement).readOnly === true ||
            el.getAttribute("aria-readonly") === "true",
          disabled:
            (el as HTMLInputElement).disabled === true ||
            el.getAttribute("aria-disabled") === "true",
        }))
        .catch(() => ({ type: "", readOnly: false, disabled: false }));

      if (meta.disabled) {
        return `ERROR: ${ref} is disabled, so it cannot be filled. Something earlier in the form probably has to be set first (or the field is genuinely not editable in this state).`;
      }

      // Read-only text fields in this product category are nearly always date
      // pickers that must be operated by clicking. Typing at them times out
      // after 10s and reads as "the app has no deadline field".
      if (meta.readOnly) {
        await loc.click({ timeout: 8_000 }).catch(() => {});
        await this.page.waitForTimeout(300);
        this.pendingNotes.push(
          `${ref} is read-only, so text cannot be typed into it — it was CLICKED instead, which normally opens a picker (calendar, time list, or dropdown). Choose "${text.slice(0, 60)}" from the elements now listed below; if no picker appeared, the field may be filled by a nearby control instead.`,
        );
        return this.snapshot();
      }

      if (TEMPORAL_FORMATS[meta.type]) {
        const norm = normalizeTemporal(meta.type, text);
        if (!norm) {
          return `ERROR: ${ref} is <input type=${meta.type}> and "${text}" could not be parsed as a ${meta.type}. Supply it as ${TEMPORAL_FORMATS[meta.type]}.`;
        }
        await loc.fill(norm);
        return (
          this.drainNotes() +
          `Filled ${ref} with: ${norm}` +
          (norm === text.trim() ? "" : ` (normalized from "${text}" for this ${meta.type} field)`)
        );
      }

      await loc.fill(text);
      return this.drainNotes() + `Filled ${ref} with: ${text.slice(0, 120)}`;
    }

    const typeInto = async (target: ReturnType<typeof this.refLocator>) => {
      await target.click();
      await this.page.keyboard.press("ControlOrMeta+a");
      await this.page.keyboard.press("Delete");
      await target.pressSequentially(text, { delay: 5 });
    };

    if ((await loc.getAttribute("contenteditable")) === "true") {
      await typeInto(loc);
      return this.drainNotes() + `Filled ${ref} with: ${text.slice(0, 120)}`;
    }

    // Inline rich-text editors nest the editable surface below the labelled
    // wrapper the snapshot pointed at (Quill .ql-editor, ProseMirror, Slate).
    const nested = loc.locator('[contenteditable="true"]').first();
    if ((await nested.count()) > 0) {
      await typeInto(nested);
      return this.drainNotes() + `Filled nested rich-text area under ${ref} with: ${text.slice(0, 120)}`;
    }

    // Classic TinyMCE: the editable body lives inside an iframe under the wrapper.
    const innerFrame = loc.locator("iframe").first();
    if ((await innerFrame.count()) > 0) {
      const fl = loc.frameLocator("iframe").first();
      const body = fl.locator("body");
      await body.click();
      await this.page.keyboard.press("ControlOrMeta+a");
      await this.page.keyboard.press("Delete");
      await body.pressSequentially(text, { delay: 5 });
      return this.drainNotes() + `Filled editor iframe under ${ref} with: ${text.slice(0, 120)}`;
    }

    // Click-to-edit. CRM-style contact fields render the current value as
    // `<button>Chief AI Officer</button>` and only swap in a focused
    // `<input placeholder="Add title...">` once clicked. fill() used to answer
    // "not an editable field", which reads as "this product cannot edit
    // contacts" — a false negative on a whole feature area. Links are excluded:
    // clicking one navigates instead of revealing an editor.
    const isLink = await loc
      .evaluate((el) => el.tagName === "A" || el.getAttribute("role") === "link")
      .catch(() => true);
    if (!isLink) {
      const scope = this.refFrames.get(ref) ?? this.page.mainFrame();
      const hasHost = await loc
        .evaluate((el) => {
          const p = el.parentElement;
          if (p) p.setAttribute("data-sbek-edithost", "1");
          return !!p;
        })
        .catch(() => false);
      await loc.click({ timeout: 5_000 }).catch(() => {});
      await this.page.waitForTimeout(300);

      let target: Locator | null = null;
      const focused = scope.locator("input:focus, textarea:focus, [contenteditable='true']:focus").first();
      if ((await focused.count().catch(() => 0)) > 0) {
        target = focused;
      } else if (hasHost) {
        // Not every implementation focuses the new field; look where the old
        // value used to live.
        const revealed = scope
          .locator(
            "[data-sbek-edithost] input:not([type=hidden]), [data-sbek-edithost] textarea, [data-sbek-edithost] [contenteditable='true']",
          )
          .first();
        if ((await revealed.count().catch(() => 0)) > 0) target = revealed;
      }
      await scope
        .locator("[data-sbek-edithost]")
        .evaluateAll((els) => els.forEach((e) => e.removeAttribute("data-sbek-edithost")))
        .catch(() => {});

      if (target) {
        const editable = await target
          .evaluate((el) => el.getAttribute("contenteditable") === "true")
          .catch(() => false);
        if (editable) {
          await typeInto(target);
        } else {
          await target.fill(text);
        }
        return (
          this.drainNotes() +
          `${ref} was not directly editable, so it was CLICKED (click-to-edit field) and the input it revealed was filled with: ${text.slice(0, 120)}. Refs have shifted — take a snapshot before the next action.`
        );
      }
      this.pendingNotes.push(
        `${ref} could not be typed into, so it was clicked once in case it was a click-to-edit value — no input appeared, and the click may itself have changed the page.`,
      );
    }

    // Last resort: Playwright's own fill (raises a clear error if truly not editable).
    try {
      await loc.fill(text);
      return this.drainNotes() + `Filled ${ref} with: ${text.slice(0, 120)}`;
    } catch (err: any) {
      return (
        this.drainNotes() +
        `ERROR: ${ref} is not an editable field (${err?.message?.slice(0, 120)}). If this is a rich-text editor, take a fresh snapshot and use the [richtext] ref listed for it.`
      );
    }
  }

  /**
   * Choose a value in a dropdown. Native <select> goes through selectOption;
   * anything else is treated as a custom combobox/listbox (react-select,
   * headlessui, radix, MUI, Downshift), which is what modern apps actually
   * ship for tracks, rooms, statuses and timezones. Those are plain <div>s, so
   * selectOption throws "Element is not a <select> element" and the whole
   * field reads as unsupported.
   */
  async select(ref: string, value: string): Promise<string> {
    const loc = this.refLocator(ref);
    if (await this.refMissing(loc)) return this.stale(ref);
    const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");

    if (tag === "select") {
      try {
        await loc.selectOption({ label: value });
      } catch {
        try {
          await loc.selectOption(value);
        } catch {
          const opts = await loc
            .evaluate((el) =>
              Array.from((el as HTMLSelectElement).options)
                .slice(0, 40)
                .map((o) => (o.label || o.text || o.value).trim()),
            )
            .catch(() => [] as string[]);
          return `ERROR: no option matching "${value}" in ${ref}. Available options: ${opts.join(" | ") || "(none)"}`;
        }
      }
      return this.drainNotes() + `Selected "${value}" in ${ref}`;
    }

    return this.selectCustom(ref, loc, value);
  }

  /** Open a custom dropdown, then click the option whose text matches. */
  private async selectCustom(ref: string, loc: Locator, value: string): Promise<string> {
    const scope = this.refFrames.get(ref) ?? this.page.mainFrame();
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await loc.click({ timeout: 8_000 }).catch(() => {});
    await this.page.waitForTimeout(300);

    let picked = await this.clickOptionByText(scope, value);
    if (!picked.ok) {
      // Typeahead combobox (react-select, Downshift): the options only render
      // once the query narrows them.
      if (await this.typeIntoCombobox(loc, value)) {
        await this.page.waitForTimeout(400);
        picked = await this.clickOptionByText(scope, value);
      }
    }
    if (!picked.ok) {
      return (
        `ERROR: ${ref} is not a native <select>, and after opening it no option matching "${value}" appeared. ` +
        (picked.options.length
          ? `Options currently visible: ${picked.options.slice(0, 20).join(" | ")}. Pick one of those, or click the option's own ref from a fresh snapshot.`
          : `No option list appeared at all — this control may not be a dropdown, or its options may load asynchronously (wait, snapshot, then click the option directly).`)
      );
    }

    await this.page.waitForTimeout(250);
    const now = await loc
      .evaluate((el) =>
        ((el as HTMLInputElement).value || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      )
      .catch(() => "");
    return (
      this.drainNotes() +
      `Selected "${picked.matched}" in ${ref} (custom dropdown: opened it and clicked the matching option).` +
      (now ? ` The control now reads "${now}".` : "") +
      ` Refs have shifted — take a snapshot before the next action.`
    );
  }

  /**
   * Find a visible option whose text matches and click it. Options are
   * routinely portalled to the end of <body>, far from the trigger, so the
   * search is frame-wide (and shadow-piercing).
   */
  private async clickOptionByText(
    scope: Frame,
    value: string,
  ): Promise<{ ok: boolean; matched: string; options: string[] }> {
    const found = await scope
      .evaluate((wanted: string) => {
        const norm = String(wanted).replace(/\s+/g, " ").trim().toLowerCase();
        const roots: (Document | ShadowRoot)[] = [document];
        const all: HTMLElement[] = [];
        let ri = 0;
        while (ri < roots.length && all.length < 20000) {
          const list = roots[ri].querySelectorAll<HTMLElement>("*");
          ri += 1;
          for (let k = 0; k < list.length; k++) {
            const el = list[k];
            all.push(el);
            if (el.shadowRoot) roots.push(el.shadowRoot);
            if (all.length >= 20000) break;
          }
        }
        const optSel =
          '[role="option"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="treeitem"],li,[data-value],[class*="option"],[class*="item"]';
        const texts: string[] = [];
        let exact: HTMLElement | null = null;
        let loose: HTMLElement | null = null;
        for (let k = 0; k < all.length; k++) {
          const el = all[k];
          let m = false;
          try {
            m = el.matches(optSel);
          } catch (e) {
            m = false;
          }
          if (!m) continue;
          const st = window.getComputedStyle(el);
          if (st.display === "none" || st.visibility === "hidden") continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          // Prefer leaf options over the menu wrapper that contains them.
          if (el.querySelector(optSel)) continue;
          // Prefer the accessible name: in a day-picker grid the leading and
          // trailing grey days DUPLICATE the visible text ("31" appears in
          // both July and August), and only aria-label ("August 31st, 2026")
          // tells them apart.
          const t = (el.getAttribute("aria-label") || el.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
          if (!t || t.length > 120) continue;
          if (texts.length < 25) texts.push(t);
          const lt = t.toLowerCase();
          if (!exact && lt === norm) exact = el;
          if (!loose && lt.indexOf(norm) >= 0) loose = el;
        }
        const target: HTMLElement | null = exact || loose;
        if (target) target.setAttribute("data-sbek-opt", "1");
        return {
          ok: !!target,
          matched: target
            ? (target.getAttribute("aria-label") || target.textContent || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 80)
            : "",
          options: texts,
        };
      }, value)
      .catch(() => ({ ok: false, matched: "", options: [] as string[] }));

    if (found.ok) {
      const opt = scope.locator('[data-sbek-opt="1"]').first();
      await opt.click({ timeout: 5_000 }).catch(() => {});
      await scope
        .locator('[data-sbek-opt="1"]')
        .evaluateAll((els) => els.forEach((e) => e.removeAttribute("data-sbek-opt")))
        .catch(() => {});
    }
    return found;
  }

  /** react-select and friends keep a real <input> inside the control. */
  private async typeIntoCombobox(loc: Locator, value: string): Promise<boolean> {
    const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
    let target: Locator | null = null;
    if (tag === "input") {
      target = loc;
    } else {
      const inner = loc.locator("input:not([type=hidden])").first();
      if ((await inner.count().catch(() => 0)) > 0) target = inner;
    }
    if (!target) return false;
    await target.fill("").catch(() => {});
    await target.pressSequentially(value, { delay: 20 }).catch(() => {});
    return true;
  }

  /** Set a file input's files (for headshot/slides/CSV upload flows). */
  async upload(ref: string, absoluteFilePath: string): Promise<string> {
    const loc = this.refLocator(ref);
    if (await this.refMissing(loc)) return this.stale(ref);
    const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
    if (tag === "input") {
      await loc.setInputFiles(absoluteFilePath);
      return this.drainNotes() + `Uploaded ${path.basename(absoluteFilePath)} to ${ref}`;
    }
    // Fingerprint the file inputs that exist BEFORE the click, in every frame.
    // "Upload Files" often opens a NESTED third-party picker (Filestack et al)
    // that mounts its own `input[type=file]` — 0x0, opacity:0, multiple — and
    // never fires a native chooser event. Without this mark we cannot tell that
    // input from an unrelated one already sitting on the page, and picking the
    // wrong one is worse than failing.
    for (const f of this.page.frames()) {
      await f
        .evaluate(() => {
          const els = document.querySelectorAll('input[type="file"]');
          for (let k = 0; k < els.length; k++) els[k].setAttribute("data-sbek-file-before", "1");
        })
        .catch(() => {});
    }

    // The ref may be a styled button that opens a native chooser. Await the
    // chooser and the click together so neither can reject unhandled.
    try {
      const [fc] = await Promise.all([
        this.page.waitForEvent("filechooser", { timeout: 8_000 }),
        loc.click({ timeout: 8_000 }),
      ]);
      await fc.setFiles(absoluteFilePath);
      return this.drainNotes() + `Uploaded ${path.basename(absoluteFilePath)} via file chooser triggered by ${ref}`;
    } catch {
      /* fall through to the hidden-input path */
    }

    // No chooser fired. Re-scan every frame for a file input that appeared (or
    // became present) since the click, however invisible — this is what a
    // nested Filestack/Uppy/Dropzone modal leaves behind. Reporting "did not
    // open a file chooser and it is not a file input" here would be a false
    // negative on the entire content-management area.
    await this.page.waitForTimeout(600);
    for (const f of this.page.frames()) {
      const fresh = f.locator('input[type="file"]:not([data-sbek-file-before])').first();
      if ((await fresh.count().catch(() => 0)) === 0) continue;
      try {
        await fresh.setInputFiles(absoluteFilePath);
        return (
          this.drainNotes() +
          `Uploaded ${path.basename(absoluteFilePath)} via a file input that appeared after clicking ${ref} (a nested upload picker opened and mounted a hidden input instead of firing a file chooser). Snapshot to confirm the app registered the file.`
        );
      } catch {
        /* try the next frame */
      }
    }

    // Drop zones (react-dropzone and hand-rolled ones) keep a display:none
    // <input type=file> inside the zone, which the snapshot skips because it
    // is invisible. Setting files on it directly is what a real drop does.
    const scope = this.refFrames.get(ref) ?? this.page.mainFrame();
    for (const hidden of [loc.locator('input[type="file"]').first(), scope.locator('input[type="file"]').first()]) {
      if ((await hidden.count().catch(() => 0)) === 0) continue;
      try {
        await hidden.setInputFiles(absoluteFilePath);
        return (
          this.drainNotes() +
          `Uploaded ${path.basename(absoluteFilePath)} via the hidden file input behind ${ref} (drop zone). Snapshot to confirm the app registered the file.`
        );
      } catch {
        /* try the next candidate */
      }
    }
    return `ERROR: ${ref} is not a file input, clicking it opened no file chooser, no file input appeared afterwards in any frame, and no hidden file input was found near it. This may be a drag-and-drop-only zone with no file input at all.`;
  }

  /**
   * Drag one element onto another. Agenda/schedule builders are commonly
   * drag-and-drop, so this is load-bearing for those scenarios. Tries
   * Playwright's dragTo first, then a manual mouse sequence (which some
   * HTML5-DnD and pointer-event implementations require).
   */
  async drag(fromRef: string, toRef: string): Promise<string> {
    const from = this.refLocator(fromRef);
    const to = this.refLocator(toRef);
    if (await this.refMissing(from)) return `ERROR: source ref ${fromRef} not found. Take a new snapshot.`;
    if (await this.refMissing(to)) return `ERROR: target ref ${toRef} not found. Take a new snapshot.`;

    await from.scrollIntoViewIfNeeded().catch(() => {});
    try {
      await from.dragTo(to, { timeout: 8_000 });
    } catch {
      // Manual fallback: some grids only respond to real pointer movement.
      const a = await from.boundingBox();
      const b = await to.boundingBox();
      if (!a || !b) return `ERROR: could not compute drag geometry for ${fromRef} -> ${toRef}.`;
      await this.page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await this.page.mouse.down();
      // Intermediate moves: many DnD libraries ignore a single jump.
      for (let i = 1; i <= 5; i++) {
        await this.page.mouse.move(
          a.x + a.width / 2 + ((b.x - a.x) * i) / 5,
          a.y + a.height / 2 + ((b.y - a.y) * i) / 5,
          { steps: 4 },
        );
      }
      await this.page.mouse.up();
    }
    await this.page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
    return this.snapshot();
  }

  async press(key: string): Promise<string> {
    await this.page.keyboard.press(key);
    await this.page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    const originMsg = await this.enforceOrigin();
    return this.drainNotes() + (originMsg ? originMsg + "\n" : "") + `Pressed ${key}`;
  }

  /**
   * Scroll the page, or a specific scroll container when `ref` is given.
   *
   * Long session/speaker/submission lists routinely live in their own
   * overflow:auto box (or are virtualised), and the window scrollbar does not
   * move them at all — so the agent scrolls, sees the same 12 rows, and
   * concludes the app only has 12 sessions. `mouse.wheel` also used to fire at
   * the default cursor position (0,0), which is whatever sits in the top-left
   * corner rather than the content.
   */
  async scroll(direction: "up" | "down", ref?: string): Promise<string> {
    const dy = direction === "down" ? 600 : -600;

    if (ref) {
      const loc = this.refLocator(ref);
      if (await this.refMissing(loc)) return this.stale(ref);
      const res = await loc
        .evaluate((el, d) => {
          let node: HTMLElement | null = el as HTMLElement;
          let hops = 0;
          while (node && hops < 20) {
            const st = window.getComputedStyle(node);
            const scrollable =
              (st.overflowY === "auto" || st.overflowY === "scroll") &&
              node.scrollHeight - node.clientHeight > 4;
            if (scrollable) {
              const before = node.scrollTop;
              node.scrollTop = before + d;
              return { found: true, moved: node.scrollTop !== before, at: node.scrollTop, max: node.scrollHeight - node.clientHeight };
            }
            node = node.parentElement;
            hops += 1;
          }
          return { found: false, moved: false, at: 0, max: 0 };
        }, dy)
        .catch(() => ({ found: false, moved: false, at: 0, max: 0 }));
      await this.page.waitForTimeout(400); // let lazy loaders fire
      if (!res.found) {
        return (
          this.drainNotes() +
          `${ref} is not inside a scrollable container, so nothing was scrolled. Use scroll without a ref to scroll the page.`
        );
      }
      return (
        this.drainNotes() +
        `Scrolled the container holding ${ref} ${direction} (now at ${res.at} of ${res.max}px${res.moved ? "" : "; it was already at the end"}). Take a snapshot to see newly loaded rows.`
      );
    }

    const before = await this.page.evaluate(() => window.scrollY).catch(() => 0);
    const vp = this.page.viewportSize() ?? { width: 1280, height: 800 };
    // Put the cursor over the content before wheeling, or the wheel lands on
    // whatever occupies the top-left corner.
    await this.page.mouse.move(vp.width / 2, vp.height / 2).catch(() => {});
    await this.page.mouse.wheel(0, dy);
    await this.page.waitForTimeout(400);
    const after = await this.page.evaluate(() => window.scrollY).catch(() => 0);
    if (after !== before) {
      return this.drainNotes() + `Scrolled ${direction} (page is now at y=${Math.round(after)}). Take a snapshot or screenshot to see the result.`;
    }

    // The window did not move: the real scrollbar probably belongs to an inner
    // pane (app shells with a fixed chrome do this). Drive the biggest one.
    const inner = await this.page
      .evaluate((d) => {
        const els = document.querySelectorAll<HTMLElement>("*");
        let best: HTMLElement | null = null;
        let bestArea = 0;
        for (let k = 0; k < els.length && k < 20000; k++) {
          const el = els[k];
          if (el.scrollHeight - el.clientHeight <= 24) continue;
          const st = window.getComputedStyle(el);
          if (st.overflowY !== "auto" && st.overflowY !== "scroll") continue;
          const r = el.getBoundingClientRect();
          const area = r.width * r.height;
          if (area > bestArea) {
            bestArea = area;
            best = el;
          }
        }
        if (!best) return null;
        const from = best.scrollTop;
        best.scrollTop = from + d;
        const name = best.id ? `#${best.id}` : best.tagName.toLowerCase();
        return { name, moved: best.scrollTop !== from, at: best.scrollTop };
      }, dy)
      .catch(() => null);
    await this.page.waitForTimeout(400);
    if (inner?.moved) {
      return (
        this.drainNotes() +
        `The page itself does not scroll; scrolled its main inner container <${inner.name}> ${direction} instead (now at ${Math.round(inner.at)}px). Take a snapshot to see the result.`
      );
    }
    return (
      this.drainNotes() +
      `Scrolled ${direction} but nothing moved — the page is already at the ${direction === "down" ? "bottom" : "top"}. If a list looks short, it may live in its own scroll box: snapshot and call scroll with the ref marked "scrollable".`
    );
  }

  async wait(ms: number): Promise<string> {
    await this.page.waitForTimeout(Math.min(ms, 8_000));
    return this.drainNotes() + `Waited ${Math.min(ms, 8_000)}ms`;
  }

  /**
   * Saves a JPEG to the evidence dir; returns {relPath, base64}. Full-page
   * captures are clipped to a safe height: the Messages API rejects images
   * over 8000px on a side, and both the agent and the judge consume these.
   */
  async screenshot(label: string, fullPage: boolean): Promise<{ relPath: string; base64: string }> {
    this.shotCounter += 1;
    const safe = label.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 60) || "shot";
    // Forward slashes always: these appear in report.html href/src attributes.
    const relPath = `screenshots/${String(this.shotCounter).padStart(3, "0")}-${safe}.jpg`;
    const abs = path.join(this.evidenceDir, ...relPath.split("/"));

    // Hard ceiling: the Messages API rejects any image over 2000px on a side
    // once a request carries many images — which both the agent loop and the
    // judge become. Stay under it so a tall page can never poison a request.
    const MAX_HEIGHT = 1_900;
    let options: Parameters<Page["screenshot"]>[0] = {
      path: abs,
      type: "jpeg",
      quality: 60,
      fullPage,
    };
    if (fullPage) {
      const docHeight = await this.page
        .evaluate(() => document.documentElement.scrollHeight)
        .catch(() => 0);
      if (docHeight > MAX_HEIGHT) {
        const viewport = this.page.viewportSize() ?? { width: 1280, height: 800 };
        options = {
          path: abs,
          type: "jpeg",
          quality: 60,
          fullPage: false,
          clip: { x: 0, y: 0, width: viewport.width, height: MAX_HEIGHT },
        };
        this.pendingNotes.push(
          `Full-page screenshot was clipped to the first ${MAX_HEIGHT}px (page is ${docHeight}px tall). Scroll and take additional screenshots if the lower content matters.`,
        );
      }
    }
    const buf = await this.page.screenshot(options);
    return { relPath, base64: buf.toString("base64") };
  }
}
