/*
 * Agent step 4: the agent speaks in a real Google Meet.
 *
 *   pnpm --filter @relaya/agent try-speak <meet link> [--voice af_heart]
 *
 * Joins like try-join (click Admit), then waits for you in this terminal:
 *   type a sentence + Enter   the agent says it in the call, then re-mutes
 *   s + Enter                 stop the agent mid-sentence
 *   q + Enter (or Ctrl+C)     leave the meeting
 */
import { createInterface } from "node:readline";
import { hasSavedSession, openAgentBrowser } from "../browser.js";
import { DEFAULT_VOICE, isVoiceId, loadTts, synthesize, VOICES } from "../audio/tts.js";
import { joinMeet, leaveMeet } from "../meet/join.js";
import { speakInMeet, stopSpeaking } from "../meet/speak.js";
import { parseTryJoinArgs } from "./args.js";

async function main() {
  const argv = process.argv.slice(2);
  const voiceIndex = argv.indexOf("--voice");
  const voice = voiceIndex >= 0 ? argv.splice(voiceIndex, 2)[1] ?? "" : DEFAULT_VOICE;
  if (!isVoiceId(voice)) throw new Error(`Unknown voice "${voice}". Choose one of: ${Object.keys(VOICES).join(", ")}`);
  const args = parseTryJoinArgs(argv);

  console.log(hasSavedSession() ? "Using the bot's saved Google sign-in." : "Not signed in (run setup-account first if Meet refuses).");
  // Load the voice while joining, so the first sentence is quick.
  const voiceReady = loadTts().then(() => console.log(`Voice ready: ${VOICES[voice]}.`));

  console.log("Starting Chrome…");
  const { browser, context } = await openAgentBrowser();
  const page = await context.newPage();
  const close = async () => { await leaveMeet(page).catch(() => undefined); await browser.close().catch(() => undefined); };

  const result = await joinMeet(page, {
    url: args.url, displayName: args.displayName,
    onStatus: (status, detail) => console.log(detail ? `   ${detail}` : status === "waiting_host" ? "Asked to join. Click Admit in your meeting now." : `${status}…`),
  });
  if (result.outcome !== "admitted") {
    console.log(`Didn't get in: ${result.outcome}${result.detail ? ` (${result.detail})` : ""}`);
    await close();
    process.exitCode = 1;
    return;
  }
  console.log("✅ In the meeting, muted.");
  await voiceReady;
  console.log("\nType a sentence and press Enter to have the agent say it. 's' stops it mid-sentence, 'q' leaves.\n");

  let speaking = false;
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
  const quit = async () => { rl.close(); await stopSpeaking(page); await close(); console.log("Left the meeting."); };
  process.on("SIGINT", () => { void quit(); });

  rl.prompt();
  rl.on("line", (line) => {
    const text = line.trim();
    if (text === "q" || text === "quit") { void quit(); return; }
    if (text === "s" || text === "stop") { void stopSpeaking(page).then(() => console.log("⏹ Stopped.")); return; }
    if (!text) { rl.prompt(); return; }
    if (speaking) { console.log("Still speaking. Type 's' to stop it first."); return; }
    speaking = true;
    void (async () => {
      try {
        const started = performance.now();
        const speech = await synthesize(text, { voice });
        console.log(`🔊 Speaking (${(speech.durationMs / 1000).toFixed(1)} s, ready in ${((performance.now() - started) / 1000).toFixed(1)} s)…`);
        const outcome = await speakInMeet(page, speech, (warning) => console.log(`⚠️ ${warning}`));
        console.log(outcome === "ended" ? "✓ Done, muted again." : outcome === "stopped" ? "✓ Stopped, muted again." : "⚠️ Couldn't unmute in Meet, so nothing was said.");
      } catch (error) {
        console.log(`⚠️ ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        speaking = false;
        rl.prompt();
      }
    })();
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
