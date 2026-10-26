/** Read the browser's mono 16 kHz, 16-bit PCM WAV without a server audio codec. */
export function pcmFromWav(bytes: ArrayBuffer): Buffer | null {
  const wav = Buffer.from(bytes);
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") return null;
  let validFormat = false;
  let pcm: Buffer | null = null;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const kind = wav.toString("ascii", offset, offset + 4);
    const length = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > wav.length) return null;
    if (kind === "fmt " && length >= 16) {
      validFormat = wav.readUInt16LE(start) === 1 && wav.readUInt16LE(start + 2) === 1
        && wav.readUInt32LE(start + 4) === 16000 && wav.readUInt16LE(start + 14) === 16;
    }
    if (kind === "data") pcm = wav.subarray(start, start + length);
    offset = start + length + (length % 2);
  }
  return validFormat && pcm && pcm.length > 0 && pcm.length % 2 === 0 ? pcm : null;
}

/** Send a finished push-to-talk recording to the dedicated streaming recognizer. */
export function transcribeLive(key: string, pcm: Buffer, names: string[], languageCodes: string[]): Promise<string> {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(key)}`);
    socket.binaryType = "arraybuffer";
    let settled = false;
    const finals: string[] = [];
    const timer = setTimeout(() => finish("timeout"), 4_000);
    const send = (value: unknown) => socket.send(JSON.stringify(value));
    function finish(failure?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      // Closing a connecting socket can dispatch a later error event.
      socket.onerror = () => undefined;
      try { socket.close(); } catch { /* Already closed. */ }
      const durationMs = Math.round(performance.now() - startedAt);
      if (failure) {
        console.warn("Speech provider request failed", { stage: "gemini-live-stt", durationMs, reason: failure });
        reject(new Error("Live speech recognition unavailable."));
      } else {
        console.info("Speech provider timing", { stage: "gemini-live-stt", durationMs });
        resolve(finals.join(" ").replace(/\s+/g, " ").trim());
      }
    }
    socket.onopen = () => {
      try {
        send({ setup: {
          model: `models/${process.env.GEMINI_LIVE_STT_MODEL || "gemini-3.5-transcribe-live"}`,
          generationConfig: { responseModalities: ["TEXT"] },
          realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
          inputAudioTranscription: { languageCodes, customVocabulary: names.slice(0, 100) },
        } });
      } catch { finish("network"); }
    };
    socket.onerror = () => finish("network");
    socket.onclose = () => finish("closed");
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString()) as {
          setupComplete?: object; error?: unknown;
          serverContent?: { inputTranscription?: { text?: string }; generationComplete?: boolean; turnComplete?: boolean };
        };
        if (message.error) { finish("provider"); return; }
        if (message.setupComplete) {
          send({ realtimeInput: { activityStart: {} } });
          // 100 ms chunks; the recording is already complete, so no extra pacing wait.
          for (let offset = 0; offset < pcm.length; offset += 3200) {
            send({ realtimeInput: { audio: { data: pcm.subarray(offset, offset + 3200).toString("base64"), mimeType: "audio/pcm;rate=16000" } } });
          }
          send({ realtimeInput: { activityEnd: {} } });
        }
        const content = message.serverContent;
        if (content?.inputTranscription?.text) finals.push(content.inputTranscription.text);
        // The dedicated transcriber emits generationComplete; agent models may emit turnComplete.
        if (content?.generationComplete || content?.turnComplete) finish();
      } catch { finish("invalid_response"); }
    };
  });
}
