import { MEET_AGENT_NAME, type AgentProblemReason, type AgentSessionView, type AgentStatus } from "@relaya/contracts";
import { ProgressiveSpeech } from "../audio/progressive.js";
import type { Speech, VoiceId } from "../audio/tts.js";
import type { JoinOutcome, JoinStatus } from "../meet/join.js";
import type { SpeakResult } from "../meet/speak.js";

/**
 * What a session needs from the outside world. The real implementation drives
 * Chrome and Google Meet; tests pass fakes.
 */
export interface AgentDeps {
  openMeeting(input: { url: string; displayName: string; onStatus: (status: JoinStatus) => void }): Promise<MeetingHandle>;
  /** Voice the text sentence by sentence. */
  synthesize(text: string, voice: VoiceId, speed: number): AsyncIterable<Speech>;
}

export interface MeetingHandle {
  outcome: JoinOutcome;
  detail?: string;
  /** Actionable Google sign-in or display-name problem. */
  reason?: AgentProblemReason;
  /** Say the sentences in order, starting as soon as the first is ready. */
  speak(speech: AsyncIterable<Speech>): Promise<SpeakResult>;
  stop(): Promise<void>;
  /** Still in the call? (false once the host removes the agent or the window closes) */
  inCall(): Promise<boolean>;
  leave(): Promise<void>;
}

interface Session {
  id: string;
  status: AgentStatus;
  detail: string | null;
  reason: AgentProblemReason | null;
  voice: VoiceId;
  speed: number;
  meeting: MeetingHandle | null;
  closed: boolean;
  utterances: Map<string, ProgressiveSpeech>;
  playing: string | null;
  lastPlayback: AgentSessionView["lastPlayback"];
  watcher: ReturnType<typeof setInterval> | null;
  deadline: ReturnType<typeof setTimeout> | null;
}

export class AgentError extends Error {
  constructor(readonly status: 404 | 409 | 422, message: string) { super(message); }
}

const MAX_UTTERANCES = 20;
export const LEFT_REMOVED = "The agent is no longer in the meeting. The host may have removed it.";
export const LEFT_TIME_LIMIT = "The agent reached its time limit for this meeting and left.";
export const LEFT_QUOTA = "You've used this month's Speak for me sessions, so the agent left.";
const IN_CALL_CHECK_MS = 3000;

/**
 * One agent in one meeting at a time: it's a single laptop. A new join
 * replaces any previous session, so a refreshed or abandoned web app tab can
 * never leave a second bot in a call.
 */
export class SessionManager {
  private sessions = new Map<string, Session>();
  private utteranceCount = 0;

  constructor(private deps: AgentDeps) {}

  view(id: string): AgentSessionView {
    const s = this.get(id);
    return { agentSessionId: s.id, status: s.status, detail: s.detail, playing: s.playing, lastPlayback: s.lastPlayback, reason: s.reason };
  }

  async join(input: {
    agentSessionId: string; meetingUrl: string; displayName: string; voice: VoiceId; speed?: number | undefined;
    /** Leave after this long in the call. */
    maxSeconds: number;
    /** Called once the host admits the agent. Resolving false makes it leave. */
    onAdmitted?: (() => Promise<boolean>) | undefined;
  }): Promise<AgentSessionView> {
    if (this.sessions.has(input.agentSessionId)) return this.view(input.agentSessionId);
    await Promise.all([...this.sessions.keys()].map((id) => this.leave(id)));

    const session: Session = {
      id: input.agentSessionId, status: "preparing", detail: null, reason: null, voice: input.voice, speed: input.speed ?? 1, meeting: null, closed: false,
      utterances: new Map(), playing: null, lastPlayback: null, watcher: null, deadline: null,
    };
    this.sessions.set(session.id, session);

    void this.deps.openMeeting({
      url: input.meetingUrl, displayName: MEET_AGENT_NAME,
      onStatus: (status) => { if (!session.closed && status === "waiting_host") session.status = "waiting_host"; },
    }).then(async (meeting) => {
      if (session.closed) { await meeting.leave(); return; }
      session.meeting = meeting;
      session.status = meeting.outcome;
      session.detail = meeting.detail ?? null;
      session.reason = meeting.reason ?? null;
      if (meeting.outcome !== "admitted") { await meeting.leave(); return; }
      this.watch(session);
      session.deadline = setTimeout(() => { void this.end(session, LEFT_TIME_LIMIT); }, input.maxSeconds * 1000);
      // If usage can't be recorded (API down), stay: the user shouldn't lose a meeting to our outage.
      const allowed = await input.onAdmitted?.().catch(() => true);
      if (allowed === false) await this.end(session, LEFT_QUOTA);
    }).catch((error: unknown) => {
      if (session.closed) return;
      session.status = "failed";
      session.detail = error instanceof Error ? error.message : String(error);
    });

    return this.view(session.id);
  }

  /**
   * Start voicing now, and answer once the first sentence is ready: Approve can
   * play right away while the rest is voiced behind it ("audio_ready").
   */
  async prepare(id: string, text: string): Promise<{ utteranceId: string; textHash: string; durationMs: number }> {
    const s = this.live(id);
    // A new draft replaces the old ones; stop voicing those so this one gets the CPU.
    for (const [key, old] of s.utterances) if (key !== s.playing && !old.done) old.cancel();
    const speech = new ProgressiveSpeech(this.deps.synthesize(text, s.voice, s.speed));
    const utteranceId = `u${++this.utteranceCount}`;
    s.utterances.set(utteranceId, speech);
    // Keep memory bounded; old drafts are never played.
    for (const key of [...s.utterances.keys()].slice(0, Math.max(0, s.utterances.size - MAX_UTTERANCES))) s.utterances.delete(key);
    const startedAt = performance.now();
    const first = await speech.first();
    console.log(`🗣  Voicing ${utteranceId}: first sentence ready in ${((performance.now() - startedAt) / 1000).toFixed(1)} s, the rest continues in the background.`);
    return { utteranceId, textHash: utteranceId, durationMs: first.durationMs };
  }

  play(id: string, utteranceId: string): void {
    const s = this.live(id);
    const speech = s.utterances.get(utteranceId);
    if (!speech) throw new AgentError(404, "That sentence isn't prepared. Prepare it again.");
    if (s.playing) throw new AgentError(409, "The agent is already speaking.");
    s.playing = utteranceId;
    s.status = "speaking";
    void s.meeting!.speak(speech).then(
      (result) => { s.lastPlayback = { utteranceId, result }; },
      () => { s.lastPlayback = { utteranceId, result: "stopped" }; },
    ).finally(() => {
      s.playing = null;
      if (s.status === "speaking") s.status = "admitted";
    });
  }

  async stop(id: string): Promise<void> {
    const s = this.get(id);
    if (s.meeting && s.playing) await s.meeting.stop();
  }

  async leave(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    await this.end(s, null);
  }

  async leaveAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.leave(id)));
  }

  /**
   * Out of the meeting for good: closes the browser. The session stays readable
   * (status "left" with the reason) until the web app leaves or a new join.
   */
  private async end(s: Session, detail: string | null) {
    if (s.closed) return;
    s.closed = true;
    if (s.watcher) clearInterval(s.watcher);
    if (s.deadline) clearTimeout(s.deadline);
    s.status = "left";
    s.detail = detail;
    s.playing = null;
    await s.meeting?.stop().catch(() => undefined);
    await s.meeting?.leave().catch(() => undefined);
  }

  private watch(s: Session) {
    let misses = 0;
    s.watcher = setInterval(() => {
      if (!s.meeting || s.closed || s.playing) return;
      void s.meeting.inCall().then((inCall) => {
        misses = inCall ? 0 : misses + 1;
        if (misses >= 2) void this.end(s, LEFT_REMOVED);
      });
    }, IN_CALL_CHECK_MS);
  }

  private get(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new AgentError(404, "No such agent session. It may have left the meeting.");
    return s;
  }

  private live(id: string): Session {
    const s = this.get(id);
    if (!s.meeting || (s.status !== "admitted" && s.status !== "speaking")) throw new AgentError(409, "The agent isn't in the meeting.");
    return s;
  }
}
