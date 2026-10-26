import { useCallback, useState } from "react";

export type MicStatus = "unchecked" | "checking" | "ready" | "blocked" | "unavailable";

/** Asks for microphone permission once and reports the device label. */
export function useMicCheck() {
  const [status, setStatus] = useState<MicStatus>("unchecked");
  const [label, setLabel] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setStatus("unavailable"); return; }
    setStatus("checking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setLabel(stream.getAudioTracks()[0]?.label || null);
      stream.getTracks().forEach((track) => track.stop());
      setStatus("ready");
    } catch {
      setStatus("blocked");
    }
  }, []);

  return { status, label, check };
}
