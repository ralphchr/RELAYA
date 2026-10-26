import { createContext, useContext, type ReactNode } from "react";
import type { AgentService, Services } from "./types.js";
import { mockServices } from "./mock/index.js";
import { httpPipeline } from "./httpPipeline.js";
import { createHttpAgent } from "./httpAgent.js";
import { httpSessions } from "./httpSessions.js";
import { apiBase, realApi } from "./api.js";
import { getSession, isGuestPreview } from "../features/auth/client.js";

// Speak for me uses the real agent when VITE_AGENT_URL is set (e.g. http://127.0.0.1:8788).
// With a real API it first asks for a ticket (login and plan checked).
const agentUrl = import.meta.env.VITE_AGENT_URL as string | undefined;
const liveAgent = agentUrl ? createHttpAgent(agentUrl, { api: realApi ? { base: apiBase, token: () => getSession()?.access_token ?? null } : null }) : mockServices.agent;
const guestAwareAgent: AgentService = {
  join(input, onStatus) { return (isGuestPreview() ? mockServices.agent : liveAgent).join(input, onStatus); },
  watch(id, onLeft) { return (isGuestPreview() ? mockServices.agent : liveAgent).watch(id, onLeft); },
  prepare(id, text) { return (isGuestPreview() ? mockServices.agent : liveAgent).prepare(id, text); },
  play(id, hash, onEnded) { (isGuestPreview() ? mockServices.agent : liveAgent).play(id, hash, onEnded); },
  stop(id) { (isGuestPreview() ? mockServices.agent : liveAgent).stop(id); },
  leave(id) { (isGuestPreview() ? mockServices.agent : liveAgent).leave(id); },
};
const guestAwarePipeline: Services["pipeline"] = {
  reconstruct(input, signal) {
    return (isGuestPreview() || !realApi ? mockServices.pipeline : httpPipeline).reconstruct(input, signal);
  },
  reconstructTranscript(input, signal) {
    return (isGuestPreview() || !realApi ? mockServices.pipeline : httpPipeline).reconstructTranscript(input, signal);
  },
};
const defaultServices: Services = {
  ...mockServices,
  pipeline: guestAwarePipeline,
  ...(realApi ? { sessions: httpSessions } : {}),
  agent: guestAwareAgent,
};
const ServicesContext = createContext<Services>(defaultServices);

export function ServicesProvider({ services = defaultServices, children }: { services?: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export const useServices = () => useContext(ServicesContext);
