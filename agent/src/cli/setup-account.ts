/*
 * One-time setup: sign the agent in to the bot's own Google account. Use a
 * separate Gmail made for the bot, never your personal one.
 *
 *   pnpm --filter @relaya/agent setup-account
 *
 * Sign in in the window that opens. Once Google lands on Meet, the sign-in is
 * saved to agent/.profile/google-session.json (git-ignored) and the window
 * closes by itself.
 */
import { openAgentBrowser, saveSession, SESSION_FILE } from "../browser.js";
import { describeAccount, signedInGoogleAccount } from "../google-account.js";

const SIGN_IN_URL = "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmeet.google.com%2F";
const CHECK_EVERY_MS = 1500;

async function main() {
  console.log("Starting Chrome…");
  const { browser, context } = await openAgentBrowser({ signedIn: false });
  const page = await context.newPage();
  await page.bringToFront().catch(() => undefined);
  await page.goto(SIGN_IN_URL);
  console.log("Sign in to the bot's Google account in the Chrome window (check the taskbar or Alt+Tab if you don't see it).");
  console.log("It closes by itself when it's done. Don't close it yourself.");

  let closed = false;
  page.on("close", () => { closed = true; });
  browser.on("disconnected", () => { closed = true; });

  let account: Awaited<ReturnType<typeof signedInGoogleAccount>> = null;
  while (!closed) {
    await new Promise((resolve) => setTimeout(resolve, CHECK_EVERY_MS));
    if (closed) break;
    // Done once Google has sent the window on to Meet: 2-step prompts are finished by then.
    const onMeet = (() => { try { return new URL(page.url()).hostname === "meet.google.com"; } catch { return false; } })();
    if (!onMeet) continue;
    account = await signedInGoogleAccount(context);
    if (account && await saveSession(context).catch(() => false)) break;
    account = null;
  }

  await browser.close().catch(() => undefined);
  if (account) {
    console.log(`✅ Signed in as ${describeAccount(account)}. Saved to ${SESSION_FILE}.`);
    console.log("Signed-in Meet uses this Google profile name. Set the dedicated bot account's first name to RELAYA and last name to AI before joining.");
    console.log("Start the agent with: pnpm --filter @relaya/agent dev");
  } else {
    console.log("⚠️ The window was closed before sign-in finished, so nothing was saved. Run setup-account again.");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
