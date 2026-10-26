/** Push-to-talk recorder. Opus in WebM where supported, AAC in MP4 on Safari. */
export interface Recording { blob: Blob; durationMs: number }

export interface Recorder {
  /** Turn the microphone on ahead of time so the first word isn't lost. Safe to call repeatedly. */
  warmUp(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<Recording>;
  cancel(): void;
  /** Turn the microphone off. Call when the session ends. */
  dispose(): void;
}

export class RecorderError extends Error {
  constructor(readonly code: "MIC_DENIED" | "MIC_UNSUPPORTED" | "MIC_MISSING" | "MIC_BUSY" | "MIC_LOST", message: string) {
    super(message);
    this.name = "RecorderError";
  }
}

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

/** Keep recording briefly after release so the last syllable isn't clipped. */
const TAIL_MS = 300;
const CONSTRAINTS: MediaStreamConstraints = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

/*
 * The microphone stays open for the whole session and recording starts the
 * instant the key goes down. Opening the mic on every press took long enough
 * that the first word (often the hedge, like "Siguro") was never recorded.
 * Nothing is recorded between presses; the browser shows its mic indicator
 * while the session is open.
 */
export function createRecorder(): Recorder {
  let stream: MediaStream | null = null;
  let opening: Promise<MediaStream> | null = null;
  let starting: Promise<void> | null = null;
  let media: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;

  const supported = () => typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  const live = () => stream !== null && stream.getAudioTracks().some((track) => track.readyState === "live");

  const openMic = (): Promise<MediaStream> => {
    if (live() && stream) return Promise.resolve(stream);
    opening ??= navigator.mediaDevices.getUserMedia(CONSTRAINTS)
      .then((opened) => { stream = opened; return opened; })
      .catch((error: unknown) => {
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotFoundError" || name === "OverconstrainedError") throw new RecorderError("MIC_MISSING", "No microphone was found.");
        if (name === "NotReadableError" || name === "AbortError") throw new RecorderError("MIC_BUSY", "The microphone couldn't be started.");
        throw new RecorderError("MIC_DENIED", "Microphone permission was not granted.");
      })
      .finally(() => { opening = null; });
    return opening;
  };

  const closeMic = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };

  const cancel = () => {
    if (media && media.state !== "inactive") { media.onstop = null; media.stop(); }
    media = null;
    starting = null;
    chunks = [];
  };

  return {
    async warmUp() {
      if (supported()) await openMic();
    },
    start() {
      if (!supported()) return Promise.reject(new RecorderError("MIC_UNSUPPORTED", "Recording is not supported in this browser."));
      starting = (async () => {
        const mic = await openMic();
        const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
        media = new MediaRecorder(mic, mimeType ? { mimeType } : undefined);
        chunks = [];
        media.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        media.start();
        startedAt = performance.now();
      })();
      return starting;
    },
    async stop() {
      // Releasing before the mic opened still produces a (short) recording.
      await starting?.catch(() => undefined);
      starting = null;
      const active = media;
      media = null;
      // Unplugged mid-recording: the track ends and the recording is cut short.
      if (stream && stream.getAudioTracks().every((track) => track.readyState === "ended")) {
        if (active && active.state !== "inactive") { active.onstop = null; active.stop(); }
        closeMic();
        throw new RecorderError("MIC_LOST", "The microphone disconnected.");
      }
      if (!active || active.state === "inactive") return { blob: new Blob(), durationMs: 0 };
      await new Promise((resolve) => setTimeout(resolve, TAIL_MS));
      const durationMs = Math.round(performance.now() - startedAt);
      const done = new Promise<Recording>((resolve) => {
        active.onstop = () => resolve({ blob: new Blob(chunks, { type: active.mimeType }), durationMs });
      });
      active.stop();
      return done;
    },
    cancel,
    dispose() {
      cancel();
      closeMic();
    },
  };
}
