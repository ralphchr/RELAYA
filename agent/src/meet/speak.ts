import type { Page } from "playwright";
import type { Speech } from "../audio/tts.js";
import { playInPage, stopInPage } from "./audio-bridge.js";
import { setMicInCall } from "./join.js";

export type SpeakResult = "ended" | "stopped" | "unmute_failed";

/** Give Meet a moment to start sending before the first word, and after the last. */
const LEAD_MS = 350;
const TAIL_MS = 250;

/** Stop requests for a page that is between sentences (nothing playing to cut). */
const stopRequests = new WeakMap<Page, () => void>();

/**
 * Say one approved text in the call: unmute, play its sentences through the
 * agent's microphone as each is voiced, re-mute. The agent is muted at every
 * other moment, and refuses to play if it can't confirm it is unmuted (nobody
 * would hear it). Accepts one clip or sentences still being voiced.
 */
export async function speakInMeet(page: Page, speech: Speech | AsyncIterable<Speech>, onWarning: (message: string) => void = () => undefined): Promise<SpeakResult> {
  const parts: AsyncIterable<Speech> = Symbol.asyncIterator in speech ? speech : (async function* () { yield speech; })();
  let stopped = false;
  const stop = new Promise<"stopped">((resolve) => stopRequests.set(page, () => { stopped = true; resolve("stopped"); }));
  const askedAt = performance.now();
  const unmuted = await setMicInCall(page, true);
  console.log(`   ${unmuted ? "🎙 unmuted" : "⚠️ couldn't unmute"} in ${((performance.now() - askedAt) / 1000).toFixed(1)} s`);
  if (!unmuted) {
    stopRequests.delete(page);
    // Whatever happened, leave the mic off.
    await setMicInCall(page, false);
    return "unmute_failed";
  }
  await page.waitForTimeout(LEAD_MS);
  let result: SpeakResult = stopped ? "stopped" : "ended";
  const iterator = parts[Symbol.asyncIterator]();
  let said = 0;
  try {
    while (result === "ended") {
      // Waiting for the next sentence to be voiced: Stop must still work here.
      const next = await Promise.race([iterator.next(), stop]);
      if (next === "stopped") { result = "stopped"; break; }
      if (next.done) break;
      console.log(`   ▶ sentence ${++said} (${(next.value.durationMs / 1000).toFixed(1)} s)`);
      result = await playInPage(page, next.value);
      if (stopped) result = "stopped";
    }
    if (result === "ended") await page.waitForTimeout(TAIL_MS);
  } finally {
    stopRequests.delete(page);
    void iterator.return?.();
    const muteAt = performance.now();
    const muted = await setMicInCall(page, false);
    console.log(`   🔇 ${muted ? "muted again" : "mute not confirmed"} in ${((performance.now() - muteAt) / 1000).toFixed(1)} s`);
    if (!muted) onWarning("Couldn't confirm the agent re-muted. It is silent anyway (nothing is playing), but check its tile in Meet.");
  }
  return result;
}

/** Cut what's being said (or waiting to be said); speakInMeet then re-mutes. */
export async function stopSpeaking(page: Page) {
  stopRequests.get(page)?.();
  await stopInPage(page);
}
