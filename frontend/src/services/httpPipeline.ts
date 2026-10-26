import { ApiErrorSchema, ReconstructResponseSchema } from "@relaya/contracts";
import { getSession, restoreSession } from "../features/auth/client.js";
import { apiBase } from "./api.js";
import { ServiceError, type PipelineService } from "./types.js";
import { toSpeechWav } from "./pcmAudio.js";

export const httpPipeline: PipelineService = {
  async reconstruct(input, signal) {
    // Renew a login that's about to expire: meetings outlast the one-hour token,
    // and a background tab's refresh timer may not have run.
    const token = (await restoreSession().catch(() => getSession()))?.access_token;
    // Retryable: after signing in again in another tab, Retry sends the same recording.
    if (!token) throw new ServiceError("UNAUTHORIZED", "You're signed out. Sign in again, then retry.", true);

    const form = new FormData();
    const audio = input.languageMode === "bisaya_english" ? await toSpeechWav(input.audio) : input.audio;
    const extension = audio.type === "audio/wav" ? "wav" : audio.type.includes("mp4") ? "m4a" : "webm";
    form.set("audio", audio, `relaya-recording.${extension}`);
    form.set("durationMs", String(input.durationMs));
    form.set("tone", input.tone);
    form.set("languageMode", input.languageMode);
    form.set("names", JSON.stringify(input.names));

    let response: Response;
    try {
      response = await fetch(`${apiBase}/reconstruct`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ServiceError("NETWORK_ERROR", "Couldn't reach Relaya. Check your connection and try again.", true);
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsedError = ApiErrorSchema.safeParse(payload);
      if (parsedError.success) {
        const { code, message, retryable } = parsedError.data.error;
        if (code === "UNAUTHORIZED") throw new ServiceError(code, "Your sign-in expired. Sign in again, then retry.", true);
        const retryAfter = Number(response.headers.get("Retry-After"));
        throw new ServiceError(code, message, retryable, retryAfter > 0 ? retryAfter * 1000 : null);
      }
      throw new ServiceError("INTERNAL", "The recording could not be processed. Please try again.", response.status >= 500);
    }

    const parsed = ReconstructResponseSchema.safeParse(payload);
    if (!parsed.success) throw new ServiceError("INTERNAL", "Relaya returned an invalid recording result. Please try again.", true);
    return parsed.data;
  },
  async reconstructTranscript(input, signal) {
    const token = (await restoreSession().catch(() => getSession()))?.access_token;
    if (!token) throw new ServiceError("UNAUTHORIZED", "You're signed out. Sign in again, then retry.", true);
    let response: Response;
    try {
      response = await fetch(`${apiBase}/reconstruct/text`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(input),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ServiceError("NETWORK_ERROR", "Couldn't reach Relaya. Check your connection and try again.", true);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsedError = ApiErrorSchema.safeParse(payload);
      if (parsedError.success) {
        const { code, message, retryable } = parsedError.data.error;
        if (code === "UNAUTHORIZED") throw new ServiceError(code, "Your sign-in expired. Sign in again, then retry.", true);
        const retryAfter = Number(response.headers.get("Retry-After"));
        throw new ServiceError(code, message, retryable, retryAfter > 0 ? retryAfter * 1000 : null);
      }
      throw new ServiceError("INTERNAL", "The corrected sentence could not be rebuilt. Please try again.", response.status >= 500);
    }
    const parsed = ReconstructResponseSchema.safeParse(payload);
    if (!parsed.success) throw new ServiceError("INTERNAL", "Relaya returned an invalid corrected sentence. Please try again.", true);
    return parsed.data;
  },
};
