import type { Page } from "playwright";
import * as S from "./selectors.js";
import { MEET_AGENT_NAME, type AgentProblemReason } from "@relaya/contracts";
import { prepareMeetIdentity } from "./identity.js";

export type JoinOutcome = "admitted" | "declined" | "timeout" | "blocked" | "failed";
export type JoinStatus = "opening" | "preparing" | "waiting_host" | JoinOutcome;
interface JoinResult { outcome: JoinOutcome; detail?: string; reason?: AgentProblemReason }

/** How long the agent's name card stays in the pre-join preview before the camera goes off. */
export const CARD_PREVIEW_MS = 3000;

export interface JoinOptions {
  url: string;
  /** Legacy caller value; the Meet participant always uses MEET_AGENT_NAME. */
  displayName: string;
  /** How long to wait for the host after asking to join. */
  admitTimeoutMs?: number;
  /** How long to show the name card before turning the camera off (default CARD_PREVIEW_MS). */
  cardPreviewMs?: number;
  onStatus?: (status: JoinStatus, detail?: string) => void;
}

const quick = { timeout: 1500 } as const;

async function clickIfVisible(page: Page, name: RegExp): Promise<boolean> {
  const button = page.getByRole("button", { name }).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click(quick).catch(() => undefined);
    return true;
  }
  return false;
}

const visible = (page: Page, name: RegExp) => page.getByRole("button", { name }).first().isVisible().catch(() => false);

/**
 * Turn a device off and confirm it: the button must flip to "Turn on …".
 * Tries a click first, then Meet's keyboard shortcut.
 */
export async function ensureOff(page: Page, offButton: RegExp, onButton: RegExp, shortcut: string, waitMs = 25_000): Promise<boolean> {
  // The buttons appear only once Meet has started the devices. On the first
  // join after Chrome starts (nothing cached yet) that can take well over 10 s.
  for (let i = 0; i < waitMs / 500 && !(await visible(page, offButton)) && !(await visible(page, onButton)); i++) await page.waitForTimeout(500);
  if (await visible(page, onButton)) return true;
  await page.getByRole("button", { name: offButton }).first().click(quick).catch(() => undefined);
  await page.waitForTimeout(600);
  if (await visible(page, onButton)) return true;
  // Out of the name field, so the shortcut goes to Meet and not the text box.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()).catch(() => undefined);
  await page.keyboard.press(shortcut).catch(() => undefined);
  await page.waitForTimeout(600);
  return visible(page, onButton);
}

/**
 * In a call: turn the agent's mic on or off. Meet hides its toolbar when the
 * mouse is idle, and hidden buttons don't count as visible, so this reads the
 * buttons whether shown or not: their label says the mic's real state ("Turn
 * off microphone" = on). It never presses the toggle shortcut without reading
 * the state first, so it can't flip the mic the wrong way.
 */
export async function setMicInCall(page: Page, on: boolean): Promise<boolean> {
  const done = on ? S.MIC_OFF_BUTTON : S.MIC_ON_BUTTON;
  const press = on ? S.MIC_ON_BUTTON : S.MIC_OFF_BUTTON;
  const has = (name: RegExp) => page.getByRole("button", { name, includeHidden: true }).count().then((n) => n > 0).catch(() => false);
  const settled = async () => {
    for (let i = 0; i < 10; i++) { if (await has(done)) return true; await page.waitForTimeout(100); }
    return false;
  };
  if (await has(done)) return true;
  // The label says the mic is the wrong way round, so the toggle shortcut is
  // safe, and Meet answers it at once (it ignores clicks scripted in the page).
  if (!(await has(press))) return false;
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()).catch(() => undefined);
  await page.keyboard.press(S.MIC_SHORTCUT).catch(() => undefined);
  if (await settled()) return true;
  // Shortcut didn't land (focus elsewhere): a real click, if the button is on screen.
  await page.getByRole("button", { name: press }).first().click({ timeout: 1500 }).catch(() => undefined);
  return settled();
}

async function textVisible(page: Page, pattern: RegExp): Promise<boolean> {
  return page.getByText(pattern).first().isVisible().catch(() => false);
}

/**
 * Meet's "You can't join this video call" page. It must be the page's main
 * message: the same words in small print on a page that still offers a Join
 * button don't count.
 */
async function blockedPage(page: Page): Promise<boolean> {
  if (await page.getByRole("heading", { name: S.BLOCKED_TEXT }).first().isVisible().catch(() => false)) return true;
  if (!(await textVisible(page, S.BLOCKED_TEXT))) return false;
  return !(await page.getByRole("button", { name: S.JOIN_BUTTON }).first().isVisible().catch(() => false));
}

/** Wait for the join button to be on screen and clickable. Meet hides it while "Getting ready…". */
async function joinButtonReady(page: Page, timeoutMs: number): Promise<boolean> {
  const button = page.getByRole("button", { name: S.JOIN_BUTTON }).first();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

/**
 * Open the link, enter the agent's name and turn the mic and camera off,
 * stopping just before Ask to join. Nothing has been sent to the host yet.
 */
async function getReady(page: Page, options: JoinOptions, report: (status: JoinStatus, detail?: string) => void): Promise<"ready" | JoinResult> {
  report("opening");
  await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  // The pre-join screen can take a few seconds and may show dialogs first.
  const nameInput = page.getByRole("textbox", { name: S.NAME_INPUT }).or(page.getByPlaceholder(S.NAME_INPUT)).first();
  const joinButton = page.getByRole("button", { name: S.JOIN_BUTTON }).first();
  const preJoinDeadline = Date.now() + 45_000;
  while (Date.now() < preJoinDeadline) {
    if (await blockedPage(page)) return { outcome: "blocked", detail: "Meet says this call can't be joined by guests." };
    if (await textVisible(page, S.ENDED_TEXT)) return { outcome: "failed", detail: "Meet says this meeting doesn't exist or has ended." };
    await clickIfVisible(page, S.DISMISS_BUTTONS);
    if (await nameInput.isVisible().catch(() => false) || await joinButton.isVisible().catch(() => false)) break;
    await page.waitForTimeout(1000);
  }

  report("preparing");
  const identity = await prepareMeetIdentity(page, options.displayName);
  if (!identity.ok) return { outcome: "failed", reason: identity.reason, detail: identity.detail };
  // Mic and camera off before joining: the agent only unmutes to say an
  // approved sentence, and refuses to join if it can't confirm that.
  // Fallback: read the button labels even if Meet keeps the buttons hidden.
  if (!(await ensureOff(page, S.MIC_OFF_BUTTON, S.MIC_ON_BUTTON, S.MIC_SHORTCUT)) && !(await setMicInCall(page, false))) {
    return { outcome: "failed", detail: "Couldn't confirm the microphone is off, so the agent didn't join." };
  }
  // Leave the name card up long enough to read in the bot's window.
  if (await visible(page, S.CAMERA_OFF_BUTTON)) await page.waitForTimeout(options.cardPreviewMs ?? CARD_PREVIEW_MS);
  // The card is drawn mirrored for the preview, so it must never reach the call.
  if (!(await ensureOff(page, S.CAMERA_OFF_BUTTON, S.CAMERA_ON_BUTTON, S.CAMERA_SHORTCUT))) {
    return { outcome: "failed", detail: "Couldn't confirm the camera is off, so the agent didn't join." };
  }
  if (!(await joinButtonReady(page, 30_000))) {
    if (await blockedPage(page)) return { outcome: "blocked", detail: "Meet says this call can't be joined by guests." };
    return { outcome: "failed", detail: "The join button didn't become clickable." };
  }
  return "ready";
}

/**
 * Open a Meet link, verify the agent's name, turn the mic and
 * camera off, ask to join, and wait for the host. Leaves the page in the call
 * when admitted.
 */
export async function joinMeet(page: Page, options: JoinOptions): Promise<JoinResult & { attempts: number }> {
  const joinOptions = { ...options, displayName: MEET_AGENT_NAME };
  const report = options.onStatus ?? (() => undefined);
  const admitTimeoutMs = options.admitTimeoutMs ?? 5 * 60_000;

  // The first try after Chrome starts is the slow one (cold cache, Google
  // refreshing the sign-in). Anything that goes wrong before Ask to join is
  // safe to retry: the host hasn't seen a request yet.
  let attempts = 1;
  let ready = await getReady(page, joinOptions, report);
  if (ready !== "ready") {
    // Reloading cannot change a Google account's profile name.
    if (ready.reason) return { ...ready, attempts };
    console.warn(`Join attempt 1 stopped before Ask to join (${(ready.detail ?? ready.outcome).replace(/\.$/, "")}). Reloading and trying once more.`);
    attempts = 2;
    ready = await getReady(page, joinOptions, report);
    if (ready !== "ready") return { ...ready, attempts };
  }

  await page.getByRole("button", { name: S.JOIN_BUTTON }).first().click();
  report("waiting_host");

  const deadline = Date.now() + admitTimeoutMs;
  while (Date.now() < deadline) {
    if (await page.getByRole("button", { name: S.LEAVE_BUTTON }).first().isVisible().catch(() => false)) return { outcome: "admitted", attempts };
    if (await textVisible(page, S.DECLINED_TEXT)) return { outcome: "declined", attempts };
    if (await textVisible(page, S.TIMEOUT_TEXT)) return { outcome: "timeout", detail: "Meet stopped waiting for the host.", attempts };
    if (await blockedPage(page)) return { outcome: "blocked", attempts };
    await page.waitForTimeout(1000);
  }
  return { outcome: "timeout", detail: `Nobody admitted the agent within ${Math.round(admitTimeoutMs / 60_000)} minutes.`, attempts };
}

/**
 * Leave the call. Click Leave call (moving the mouse first, since Meet hides
 * its toolbar when idle), then unload the page: unloading makes Meet drop
 * the agent at once even if the click didn't land, instead of leaving a
 * frozen tile behind for up to a minute.
 * While the window is minimized Chrome doesn't paint, so a normal click
 * waits forever for the button to settle; then the button is clicked from
 * inside the page instead.
 */
export async function leaveMeet(page: Page): Promise<boolean> {
  const leave = page.getByRole("button", { name: S.LEAVE_BUTTON }).first();
  if (!(await leave.isVisible().catch(() => false))) await page.mouse.move(640, 600).catch(() => undefined);
  const clicked = await leave.click({ timeout: 1500 }).then(() => true, () =>
    leave.evaluate((button) => { (button as HTMLElement).click(); }, undefined, { timeout: 1500 }).then(() => true, () => false));
  if (clicked) await page.waitForTimeout(800);
  await page.goto("about:blank", { timeout: 5000 }).catch(() => undefined);
  return clicked;
}
