import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { installAudioBridge } from "./meet/audio-bridge.js";

/**
 * The bot's saved Google sign-in (cookies), written by
 * `pnpm --filter @relaya/agent setup-account`. Meet turns away automated
 * browsers that aren't signed in. Git-ignored; delete it to sign out.
 */
export const SESSION_FILE = join(process.cwd(), ".profile", "google-session.json");

/*
 * - Fake media devices with auto-accepted permission: the agent never uses
 *   the laptop's real microphone or camera.
 * - Hide the "controlled by automated software" signals Meet treats as a bot.
 * - Mute its speakers: the agent never needs to hear the meeting, and playing
 *   it aloud echoes everyone's voice on the laptop. Its own voice is unaffected
 *   (it goes into Meet as a mic stream, not through the speakers).
 */
const ARGS = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--disable-blink-features=AutomationControlled", "--autoplay-policy=no-user-gesture-required", "--mute-audio"];
const LAUNCH_TIMEOUT_MS = 30_000;

async function launchBrowser(): Promise<Browser> {
  // AGENT_CHROME_PATH (in agent/.env.local) points at a specific Chrome if needed.
  const custom = process.env.AGENT_CHROME_PATH ? [{ executablePath: process.env.AGENT_CHROME_PATH, ignoreDefaultArgs: ["--enable-automation"] }] : [];
  const attempts = [
    ...custom,
    { channel: "chrome", ignoreDefaultArgs: ["--enable-automation"] },
    { channel: "chrome" },
    { ignoreDefaultArgs: ["--enable-automation"] },
  ];
  let lastError: unknown;
  for (const extra of attempts) {
    try {
      return await chromium.launch({ headless: false, args: ARGS, timeout: LAUNCH_TIMEOUT_MS, ...extra });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Couldn't start Chrome. Install Google Chrome, or run: pnpm --filter @relaya/agent exec playwright install chromium\n(${String(lastError).split("\n")[0]})`);
}

export const hasSavedSession = () => existsSync(SESSION_FILE);

/** Open a visible Chrome window, signed in when a session was saved. */
export async function openAgentBrowser(options: { signedIn?: boolean; cardName?: string } = {}): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await launchBrowser();
  const useSession = options.signedIn !== false && hasSavedSession();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ["microphone", "camera"],
    ...(useSession ? { storageState: SESSION_FILE } : {}),
  });
  await installAudioBridge(context, options.cardName);
  return { browser, context };
}

/** Save the current Google sign-in so later runs start signed in. */
export async function saveSession(context: BrowserContext): Promise<boolean> {
  const state = await context.storageState();
  const signedIn = state.cookies.some((c) => c.domain.endsWith("google.com") && (c.name === "SID" || c.name === "__Secure-1PSID"));
  if (!signedIn) return false;
  mkdirSync(dirname(SESSION_FILE), { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(state));
  return true;
}

/**
 * Tuck the bot's window into the taskbar once it no longer needs clicks (after
 * Ask to join). Chrome keeps the page running: the agent still talks, notices
 * being removed, and can leave. AGENT_SHOW_WINDOW=1 keeps it on screen.
 */
export async function minimizeWindow(page: Page): Promise<void> {
  if (process.env.AGENT_SHOW_WINDOW === "1") return;
  const cdp = await page.context().newCDPSession(page);
  try {
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}
