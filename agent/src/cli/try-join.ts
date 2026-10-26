/*
 * Agent step 2: can our agent join a real Google Meet?
 *
 *   pnpm --filter @relaya/agent try-join <meet link> [--stay 30]
 *
 * Opens the agent's own Chrome window (signed in to the bot's Google account
 * after `setup-account`; otherwise as a guest named "RELAYA AI"),
 * turns the mic and camera off, asks to join, and prints what happens. The
 * host must click Admit. When admitted it stays for --stay seconds, then
 * leaves. A screenshot is saved to agent/.debug/ when something goes wrong.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { hasSavedSession, openAgentBrowser } from "../browser.js";
import { joinMeet, leaveMeet, type JoinStatus } from "../meet/join.js";
import { parseTryJoinArgs } from "./args.js";

const MESSAGES: Record<JoinStatus, string> = {
  opening: "Opening the meeting…",
  preparing: "Entering the name and turning the mic and camera off…",
  waiting_host: "Asked to join. Click Admit in your meeting now.",
  admitted: "✅ Admitted! The agent is in the meeting.",
  declined: "❌ The host declined the agent.",
  timeout: "⏱️ Nobody admitted the agent in time.",
  blocked: "🚫 Meet won't let this guest join. If the agent isn't signed in yet, run: pnpm --filter @relaya/agent setup-account",
  failed: "⚠️ Something went wrong.",
};

async function main() {
  const args = parseTryJoinArgs(process.argv.slice(2));
  console.log(`Joining as "${args.displayName}"`);

  console.log(hasSavedSession() ? "Using the bot's saved Google sign-in." : "Not signed in (run setup-account first if Meet refuses).");
  console.log("Starting Chrome…");
  const { browser, context } = await openAgentBrowser();
  const page = await context.newPage();
  try {
    const result = await joinMeet(page, { url: args.url, displayName: args.displayName, onStatus: (status, detail) => console.log(detail ? `   ${detail}` : MESSAGES[status]) });
    if (result.detail) console.log(`   ${result.detail}`);

    if (result.outcome === "admitted") {
      console.log(`Staying for ${args.staySeconds} seconds (check the participant list), then leaving.`);
      await page.waitForTimeout(args.staySeconds * 1000);
      await leaveMeet(page);
      console.log("Left the meeting.");
    } else {
      const dir = join(process.cwd(), ".debug");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `try-join-${result.outcome}-${Date.now()}.png`);
      await page.screenshot({ path: file }).catch(() => undefined);
      console.log(`Saved a screenshot of what the agent saw: ${file}`);
      process.exitCode = 1;
    }
  } finally {
    await page.waitForTimeout(1500);
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
