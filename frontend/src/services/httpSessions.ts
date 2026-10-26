import { getSession } from "../features/auth/client.js";
import { apiBase } from "./api.js";
import { localSessions } from "./localData.js";
import { sessionTitle } from "./sessionTitle.js";
import type { SessionsService } from "./types.js";

/** Sessions that couldn't be recorded (API unreachable) get an id like this and are never sent. */
const UNSAVED = "unsaved-";

async function post(path: string, body: unknown): Promise<unknown> {
  const token = getSession()?.access_token;
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    // keepalive: an end request still goes out when the tab is closing.
    keepalive: true,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Session request failed (${response.status}).`);
  return response.json().catch(() => null);
}

/**
 * Session history through the API (the database only lets the API write it).
 * Recording history must never stop a call from starting, so failures fall
 * back to an unsaved session. Signed out, the preview keeps it in this browser.
 */
export const httpSessions: SessionsService = {
  async create(input) {
    const title = sessionTitle(input.mode);
    if (!getSession()?.access_token) return { id: localSessions.start({ ...input, title }) };
    try {
      const { id } = await post("/sessions", { ...input, title }) as { id: string };
      return { id };
    } catch {
      return { id: `${UNSAVED}${globalThis.crypto?.randomUUID?.() ?? Date.now()}` };
    }
  },
  async end(sessionId, stats) {
    if (sessionId.startsWith(UNSAVED)) return;
    if (!getSession()?.access_token) { localSessions.end(sessionId, stats); return; }
    await post(`/sessions/${encodeURIComponent(sessionId)}/end`, stats).catch(() => undefined);
  },
};
