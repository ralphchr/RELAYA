import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadTts } from "./audio/tts.js";
import { checkGoogleSignIn, describeAccount, type GoogleSignIn } from "./google-account.js";
import { meetDeps } from "./server/meet-deps.js";

const port = Number(process.env.AGENT_PORT || 8788);
const allowedOrigins = (process.env.AGENT_ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map((o) => o.trim()).filter(Boolean);
const ticketSecret = process.env.AGENT_TICKET_SECRET || undefined;
const apiUrl = process.env.API_URL?.replace(/\/$/, "");
const serviceKey = process.env.AGENT_SERVICE_KEY;

/** Tell the API the host let the agent in, so it spends one of the user's sessions. */
async function reportAdmission(ticket: string): Promise<boolean> {
  const response = await fetch(`${apiUrl}/api/internal/agent/admitted`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Usage report failed (${response.status}).`);
  return ((await response.json()) as { allowed?: boolean }).allowed !== false;
}

/*
 * Check the bot's Google sign-in at start and every 30 minutes. An expired
 * one is why Meet says "You can't join this video call", so say so early.
 */
const RECHECK_MS = 30 * 60_000;
let signIn: GoogleSignIn["state"] | "checking" = "checking";
async function checkSignIn(quietIfSame: boolean) {
  const result = await checkGoogleSignIn();
  if (quietIfSame && result.state === signIn) return;
  signIn = result.state;
  if (result.state === "signed_in") console.log(`Signed in to Google as ${describeAccount(result)}.`);
  else if (result.state === "missing") console.log("⚠️ The bot isn't signed in to Google. Run: pnpm --filter @relaya/agent setup-account");
  else if (result.state === "signed_out") console.log("⚠️ The bot's Google sign-in expired. Meet will refuse it. Run: pnpm --filter @relaya/agent setup-account");
  else console.log(`Couldn't check the bot's Google sign-in (${result.reason}). It will be checked again later.`);
}

const { app, sessions } = createApp(meetDeps, {
  googleSignIn: () => signIn,
  allowedOrigins,
  ticketSecret,
  ...(ticketSecret && apiUrl && serviceKey ? { reportAdmission } : {}),
});

serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(`Relaya agent listening on http://127.0.0.1:${info.port}`);
  console.log(ticketSecret
    ? `Joins need a Relaya ticket.${apiUrl && serviceKey ? " Admissions are reported to the API." : " ⚠️ Set API_URL and AGENT_SERVICE_KEY to count usage."}`
    : "Joins need no ticket (AGENT_TICKET_SECRET not set). Fine on one laptop, never on a server.");
  void checkSignIn(false);
  setInterval(() => { void checkSignIn(true); }, RECHECK_MS).unref();
  console.log("Loading the voice in the background…");
  loadTts().then(() => console.log("Voice ready.")).catch((error: unknown) => console.warn(`Voice failed to load: ${error instanceof Error ? error.message : error}`));
});

// Leave the meeting cleanly when the terminal is closed or Ctrl+C is pressed.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { void sessions.leaveAll().finally(() => process.exit(0)); });
}
