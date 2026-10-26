import type { AgentVoiceId } from "@relaya/contracts";
import type { Gender } from "./types.js";

/** Select the default voice implied by the gender the user provided. */
export function voiceForGender(gender: Gender): AgentVoiceId {
  return gender === "male" ? "am_michael" : "af_heart";
}
