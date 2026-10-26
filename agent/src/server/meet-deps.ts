import { minimizeWindow, openAgentBrowser, saveSession } from "../browser.js";
import { synthesizeSentences } from "../audio/tts.js";
import { joinMeet, leaveMeet } from "../meet/join.js";
import { speakInMeet, stopSpeaking } from "../meet/speak.js";
import * as S from "../meet/selectors.js";
import { checkGoogleSignIn } from "../google-account.js";
import type { AgentDeps } from "./sessions.js";

const SIGNED_OUT = "The bot's Google sign-in expired, so Meet treated it as an anonymous guest. Run: pnpm --filter @relaya/agent setup-account";

/** The real dependencies: Chrome + Google Meet + Kokoro. */
export const meetDeps: AgentDeps = {
  async openMeeting({ url, displayName, onStatus }) {
    const { browser, context } = await openAgentBrowser({ cardName: displayName });
    const page = await context.newPage();
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      const clicked = await leaveMeet(page).catch(() => false);
      await browser.close().catch(() => undefined);
      console.log(clicked ? "Left the meeting." : "Closed the meeting page (Leave call wasn't on screen), so Meet drops the agent.");
    };
    try {
      const started = Date.now();
      const result = await joinMeet(page, {
        url, displayName,
        onStatus: (status) => {
          // Asked to join: nothing left to click, so get the window out of the way.
          if (status === "waiting_host") void minimizeWindow(page).catch(() => undefined);
          onStatus(status);
        },
      });
      const took = `${Math.round((Date.now() - started) / 1000)} s${result.attempts > 1 ? `, ${result.attempts} tries` : ""}`;
      console.log(`Join ${result.outcome} (${took})${result.detail ? `: ${result.detail}` : ""}`);
      // Google refreshes the sign-in cookies as the bot uses them. Keep the fresh
      // ones so the next run doesn't start from a stale sign-in.
      if (result.outcome === "admitted") await saveSession(context).catch(() => undefined);
      // Turned away: tell apart an expired bot sign-in from a meeting that blocks guests.
      const signedOut = result.outcome === "blocked" && ["signed_out", "missing"].includes((await checkGoogleSignIn()).state);
      if (signedOut) console.warn(`⚠️ ${SIGNED_OUT}`);
      return {
        outcome: result.outcome,
        ...(signedOut ? { detail: SIGNED_OUT, reason: "bot_signed_out" as const } : {
          ...(result.detail ? { detail: result.detail } : {}),
          ...(result.reason ? { reason: result.reason } : {}),
        }),
        speak: (speech) => speakInMeet(page, speech, (warning) => console.warn(warning)),
        stop: () => stopSpeaking(page),
        inCall: () => page.getByRole("button", { name: S.LEAVE_BUTTON }).first().isVisible().catch(() => false),
        leave: close,
      };
    } catch (error) {
      await close();
      throw error;
    }
  },
  synthesize: (text, voice, speed) => synthesizeSentences(text, { voice, speed }),
};
