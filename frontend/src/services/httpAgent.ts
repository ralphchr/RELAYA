import { AgentSessionViewSchema, ApiErrorSchema, type AgentStatus } from "@relaya/contracts";
import type { AgentJoinProblem, AgentService } from "./types.js";

/*
 * Talks to the Speak for me agent (agent/, `pnpm --filter @relaya/agent dev`).
 * Status is polled: one meeting at a time, so this stays simple. With an API,
 * each join first gets a ticket there (login and plan checked); the agent
 * refuses joins without one once it runs with AGENT_TICKET_SECRET.
 */
const JOIN_POLL_MS = 1000;
const PLAY_POLL_MS = 400;
const WATCH_POLL_MS = 3000;
/** Consecutive failed checks before the agent counts as gone (its laptop or server is down). */
const WATCH_MAX_ERRORS = 3;
const FINAL: AgentStatus[] = ["admitted", "declined", "timeout", "blocked", "failed", "left"];

const newId = () => `s-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

class JoinProblem extends Error {
  constructor(readonly kind: AgentJoinProblem | null, message: string) { super(message); }
}

class AgentHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

interface Options {
  voice?: string;
  /** The Relaya API, for tickets. Null runs without one (local agent, no plan checks). */
  api?: { base: string; token: () => string | null } | null;
}

export function createHttpAgent(baseUrl: string, options: Options = {}): AgentService {
  const base = baseUrl.replace(/\/$/, "");
  const leaving = new Set<string>();

  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
    const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const message = (body as { error?: { message?: string } } | null)?.error?.message ?? `Agent request failed (${response.status}).`;
      throw new AgentHttpError(response.status, message);
    }
    return body;
  };
  const view = async (id: string) => AgentSessionViewSchema.parse(await request(`/sessions/${encodeURIComponent(id)}`));

  async function getTicket(meetingUrl: string, consent: boolean): Promise<string | null> {
    const api = options.api;
    if (!api) return null;
    const token = api.token();
    if (!token) throw new JoinProblem("signed_out", "Sign in again to use Speak for me.");
    let response: Response;
    try {
      response = await fetch(`${api.base}/agent/ticket`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ meetingUrl, consent }),
      });
    } catch {
      throw new JoinProblem(null, "Couldn't reach Relaya. Check your connection.");
    }
    const body: unknown = await response.json().catch(() => null);
    if (response.ok) return (body as { ticket: string | null }).ticket;
    const error = ApiErrorSchema.safeParse(body);
    const message = error.success ? error.data.error.message : "Relaya couldn't check your plan.";
    if (response.status === 429) throw new JoinProblem("quota", message);
    if (response.status === 401) throw new JoinProblem("signed_out", message);
    throw new JoinProblem(null, message);
  }

  return {
    join({ meetingUrl, displayName, consent, voice, speed }, onStatus) {
      const agentSessionId = newId();
      let stopped = false;
      let last: AgentStatus | null = null;
      const report = (status: AgentStatus) => { if (!stopped && status !== last) { last = status; onStatus(status); } };

      void (async () => {
        try {
          report("preparing");
          // Wait a tick: a join cancelled right away (React StrictMode's double mount in dev)
          // must not reach the agent, or it would open and close a browser for nothing.
          await wait(0);
          if (stopped) return;
          const ticket = await getTicket(meetingUrl, consent);
          if (stopped) return;
          try {
            const chosenVoice = voice ?? options.voice;
            await request("/sessions", { method: "POST", body: JSON.stringify({ agentSessionId, meetingUrl, displayName, ticket, ...(chosenVoice ? { voice: chosenVoice } : {}), ...(speed ? { speed } : {}) }) });
          } catch (error) {
            if (error instanceof AgentHttpError) throw new JoinProblem(null, error.message);
            throw new JoinProblem("agent_offline", "Relaya's meeting agent isn't running. Start it, then ask again.");
          }
          while (!stopped) {
            const current = await view(agentSessionId);
            if (current.reason === "bot_signed_out") {
              throw new JoinProblem("bot_signed_out", "The agent's Google account is signed out.");
            }
            if (current.reason === "bot_name_mismatch" || current.reason === "bot_name_unverified") {
              throw new JoinProblem(current.reason, current.detail ?? "Check the bot's Google profile name before joining.");
            }
            report(current.status);
            if (FINAL.includes(current.status)) return;
            await wait(JOIN_POLL_MS);
          }
        } catch (error) {
          if (stopped) return;
          last = "failed";
          const problem = error instanceof JoinProblem && error.kind ? { kind: error.kind, message: error.message } : undefined;
          onStatus("failed", problem);
        }
      })();

      // Only stops watching; leaving is a separate, explicit call.
      return { agentSessionId, cancel: () => { stopped = true; } };
    },

    watch(agentSessionId, onLeft) {
      let active = true;
      let errors = 0;
      const gone = () => { if (active && !leaving.has(agentSessionId)) { active = false; onLeft(); } };
      void (async () => {
        while (active) {
          await wait(WATCH_POLL_MS);
          if (!active || leaving.has(agentSessionId)) return;
          try {
            const current = await view(agentSessionId);
            errors = 0;
            if (current.status === "left") gone();
          } catch (error) {
            // 404: the agent restarted or dropped the session. Otherwise it's unreachable.
            if (error instanceof AgentHttpError && error.status === 404) gone();
            else if (++errors >= WATCH_MAX_ERRORS) gone();
          }
        }
      })();
      return () => { active = false; };
    },

    async prepare(agentSessionId, text) {
      const result = await request(`/sessions/${encodeURIComponent(agentSessionId)}/utterances`, { method: "POST", body: JSON.stringify({ text }) }) as { textHash: string };
      return { textHash: result.textHash };
    },

    play(agentSessionId, textHash, onEnded) {
      void (async () => {
        try {
          await request(`/sessions/${encodeURIComponent(agentSessionId)}/utterances/${encodeURIComponent(textHash)}/play`, { method: "POST" });
          for (;;) {
            await wait(PLAY_POLL_MS);
            const current = await view(agentSessionId);
            if (current.playing !== textHash) break;
          }
        } catch {
          // Unreachable or gone: treat as finished so the panel doesn't hang.
        }
        onEnded();
      })();
    },

    stop(agentSessionId) {
      void request(`/sessions/${encodeURIComponent(agentSessionId)}/stop`, { method: "POST" }).catch(() => undefined);
    },

    leave(agentSessionId) {
      if (leaving.has(agentSessionId)) return;
      leaving.add(agentSessionId);
      // keepalive: still sent when the tab is closing or navigating away.
      void request(`/sessions/${encodeURIComponent(agentSessionId)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
    },
  };
}
