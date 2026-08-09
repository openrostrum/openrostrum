import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

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

  private isOnTarget(url: string): boolean {
    if (url === "about:blank" || url.startsWith("data:")) return true;
    try {
      return new URL(url).origin === this.targetOrigin;
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

    const interactive = await this.tagInteractiveElements();
    let aria = "";
    try {
      aria = await this.page.locator("body").ariaSnapshot({ timeout: 5_000 });
    } catch {
      aria = "(aria snapshot unavailable)";
    }
    // Cap the outline so a giant page doesn't blow up the context window.
    const MAX_ARIA = 12_000;
    if (aria.length > MAX_ARIA) aria = aria.slice(0, MAX_ARIA) + "\n... (truncated)";

    const lines = interactive.map(
      (el) => `[${el.ref}] <${el.tag}${el.type ? ` type=${el.type}` : ""}> ${el.label}`,
    );
    let elementList = lines.join("\n");
    const MAX_ELEMS = 10_000;
    if (elementList.length > MAX_ELEMS) elementList = elementList.slice(0, MAX_ELEMS) + "\n... (truncated)";

    return [
      this.drainNotes() + (originMsg ? originMsg + "\n" : "") + `URL: ${url}`,
      `TITLE: ${title}`,
      ``,
      `PAGE OUTLINE (aria):`,
      aria,
      ``,
      `INTERACTIVE ELEMENTS (use these refs with click/fill/select):`,
      elementList || "(none found)",
    ].join("\n");
  }

  private async tagInteractiveElements(): Promise<
    { ref: string; tag: string; type: string; label: string }[]
  > {
    const base = this.refCounter;
    const work = this.page.evaluate((baseCount) => {
      const selector =
        'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="combobox"], [contenteditable="true"], [onclick]';
      // Bound total elements EXAMINED, not just collected, so pathological
      // pages (virtualized 20k-row tables) can't stall the snapshot.
      const els = Array.from(document.querySelectorAll<HTMLElement>(selector)).slice(0, 4000);

      // Pass 1: reads only (no interleaved writes -> no layout thrashing).
      const visible: HTMLElement[] = [];
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const style = window.getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") continue;
        visible.push(el);
        if (visible.length >= 250) break;
      }

      // Pass 2: writes + label extraction.
      const out: { ref: string; tag: string; type: string; label: string }[] = [];
      let i = baseCount;
      for (const el of visible) {
        i += 1;
        const ref = `e${i}`;
        el.setAttribute("data-sbek-ref", ref);
        const labelSource =
          el.getAttribute("aria-label") ||
          (el as HTMLInputElement).placeholder ||
          el.getAttribute("title") ||
          (el.textContent ?? "").trim() ||
          (el as HTMLInputElement).name ||
          el.id ||
          "";
        const label = labelSource.replace(/\s+/g, " ").slice(0, 90);
        out.push({
          ref,
          tag: el.tagName.toLowerCase(),
          type: (el as HTMLInputElement).type ?? "",
          label,
        });
      }
      return { out, last: i };
    }, base);

    // page.evaluate is not covered by setDefaultTimeout; guard against pages
    // whose main thread never yields.
    const result = await Promise.race([
      work,
      new Promise<{ out: []; last: number }>((resolve) =>
        setTimeout(() => resolve({ out: [], last: base }), 15_000),
      ),
    ]);
    this.refCounter = result.last;
    return result.out;
  }

  private refLocator(ref: string) {
    return this.page.locator(`[data-sbek-ref="${ref}"]`).first();
  }

  async click(ref: string): Promise<string> {
    const loc = this.refLocator(ref);
    if ((await loc.count()) === 0) {
      return `ERROR: ref ${ref} not found on the current page. Take a new snapshot to get fresh refs.`;
    }
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await loc.click({ timeout: 8_000 });
    await this.page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
    return this.snapshot();
  }

  async fill(ref: string, text: string): Promise<string> {
    const loc = this.refLocator(ref);
    if ((await loc.count()) === 0) {
      return `ERROR: ref ${ref} not found on the current page. Take a new snapshot to get fresh refs.`;
    }
    const editable = await loc.getAttribute("contenteditable");
    if (editable === "true") {
      // Clear existing content first — matches the tool's "clear and type" contract.
      await loc.click();
      await this.page.keyboard.press("ControlOrMeta+a");
      await this.page.keyboard.press("Delete");
      await loc.pressSequentially(text, { delay: 5 });
    } else {
      await loc.fill(text);
    }
    return this.drainNotes() + `Filled ${ref} with: ${text.slice(0, 120)}`;
  }

  async select(ref: string, value: string): Promise<string> {
    const loc = this.refLocator(ref);
    if ((await loc.count()) === 0) {
      return `ERROR: ref ${ref} not found on the current page. Take a new snapshot to get fresh refs.`;
    }
    try {
      await loc.selectOption({ label: value });
    } catch {
      await loc.selectOption(value);
    }
    return this.drainNotes() + `Selected "${value}" in ${ref}`;
  }

  /** Set a file input's files (for headshot/slides/CSV upload flows). */
  async upload(ref: string, absoluteFilePath: string): Promise<string> {
    const loc = this.refLocator(ref);
    if ((await loc.count()) === 0) {
      return `ERROR: ref ${ref} not found on the current page. Take a new snapshot to get fresh refs.`;
    }
    const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
    if (tag === "input") {
      await loc.setInputFiles(absoluteFilePath);
      return this.drainNotes() + `Uploaded ${path.basename(absoluteFilePath)} to ${ref}`;
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
      return `ERROR: clicking ${ref} did not open a file chooser and it is not a file input.`;
    }
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
    if ((await from.count()) === 0) return `ERROR: source ref ${fromRef} not found. Take a new snapshot.`;
    if ((await to.count()) === 0) return `ERROR: target ref ${toRef} not found. Take a new snapshot.`;

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

  async scroll(direction: "up" | "down"): Promise<string> {
    const dy = direction === "down" ? 600 : -600;
    await this.page.mouse.wheel(0, dy);
    await this.page.waitForTimeout(300);
    return this.drainNotes() + `Scrolled ${direction}. Take a snapshot or screenshot to see the result.`;
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

    const MAX_HEIGHT = 7_500;
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
