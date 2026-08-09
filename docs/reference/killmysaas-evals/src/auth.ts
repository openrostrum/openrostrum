import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { BrowserSession } from "./browser.js";
import type { EvalConfig } from "./types.js";

/**
 * Pre-authentication capture.
 *
 * Many submissions gate non-organizer personas behind magic-link email or
 * OAuth, which the browser agent cannot complete on its own (it has no inbox).
 * This opens a real browser window, lets a human sign in once, then saves the
 * session to disk. Evaluation runs restore it, so every scenario for that
 * persona starts already logged in.
 *
 * The saved file contains live session cookies — treat it as a secret. It is
 * written under .auth/ which is gitignored.
 */
export const AUTH_DIR = ".auth";

export function authStatePath(persona: string, targetUrl: string): string {
  // Scope by origin so states from different submissions never collide.
  const host = new URL(targetUrl).host.replace(/[^a-z0-9.-]/gi, "_");
  return path.join(AUTH_DIR, `${host}.${persona}.json`);
}

export function hasAuthState(persona: string, targetUrl: string): boolean {
  return fs.existsSync(authStatePath(persona, targetUrl));
}

export async function captureAuth(
  persona: string,
  config: EvalConfig,
  /** Optional path or URL to open instead of the site root, e.g. "/login". */
  startAt?: string,
  /**
   * Text of a control to click to complete sign-in (e.g. a "Sign in as
   * Speaker" demo button). When given, capture is fully scripted — no browser
   * window, no human step.
   */
  autoClick?: string,
): Promise<string> {
  const target = authStatePath(persona, config.url);
  const session = new BrowserSession(
    path.join(AUTH_DIR, "_scratch"),
    Boolean(autoClick), // headless only when no human is needed
    new URL(config.url).origin,
  );
  await session.start();
  const snap = await session.navigate(new URL(startAt ?? "", config.url).toString());

  if (autoClick) {
    await session.wait(2500);
    const fresh = await session.snapshot();
    const needle = autoClick.toLowerCase();
    const controls = fresh.split("\n").filter((l) => /^\[e\d+\]/.test(l));
    // Label text begins after the "<tag ...>" prefix.
    const labelOf = (l: string) => (l.replace(/^\[e\d+\] <[^>]*>\s*/, "").trim().toLowerCase());

    // Prefer a label that STARTS with the text: on a role-picker, "Speaker"
    // must not match "Event admin — forms, …, speaker status".
    let matches = controls.filter((l) => labelOf(l).startsWith(needle));
    if (matches.length === 0) matches = controls.filter((l) => labelOf(l).includes(needle));

    if (matches.length === 0) {
      await session.stop();
      throw new Error(
        `No clickable element matching "${autoClick}". Visible controls:\n` + controls.slice(0, 25).join("\n"),
      );
    }
    if (matches.length > 1) {
      await session.stop();
      throw new Error(
        `"${autoClick}" is ambiguous — it matches ${matches.length} controls. Use more of the label:\n` +
          matches.slice(0, 10).join("\n"),
      );
    }
    const ref = matches[0].match(/^\[(e\d+)\]/)![1];
    console.log(`  Matched control: ${matches[0].slice(0, 100)}`);
    await session.click(ref);
    await session.wait(3000);
    const after = session.page.url();
    await session.saveStorageState(target);
    await session.stop();
    fs.rmSync(path.join(AUTH_DIR, "_scratch"), { recursive: true, force: true });
    console.log(`  Clicked "${autoClick}" -> ${after}`);
    console.log(`  Saved session for "${persona}" to ${target}`);
    return target;
  }
  void snap;

  const email = config.personaEmails?.[persona] ?? config.credentials?.[persona]?.email;
  console.log(`\n  A browser window is open at ${config.url}`);
  console.log(`  Sign in as the "${persona}" persona${email ? ` using ${email}` : ""}.`);
  console.log(`  Magic link? Request it in this window, open the email on any device,`);
  console.log(`  and paste the link into THIS browser's address bar (not your own browser).`);
  console.log(`  The session only counts if it is established in this window.\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("  Press Enter once you are signed in and can see the logged-in app... ");
  rl.close();

  const finalUrl = session.page.url();
  await session.saveStorageState(target);
  await session.stop();
  fs.rmSync(path.join(AUTH_DIR, "_scratch"), { recursive: true, force: true });

  console.log(`\n  Saved session for "${persona}" to ${target} (last page: ${finalUrl})`);
  console.log(`  Scenarios with persona "${persona}" will now start already signed in.`);
  return target;
}
