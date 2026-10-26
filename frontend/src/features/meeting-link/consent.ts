/*
 * Speak for me consent, asked once per account on this browser. The API keeps
 * the real record (user_settings.agent_consented_at) when it issues a ticket.
 */
const key = (account: string | null) => `relaya.agentConsent.v1:${account ?? "guest"}`;

export function hasAgentConsent(account: string | null): boolean {
  try { return localStorage.getItem(key(account)) === "yes"; } catch { return false; }
}

export function saveAgentConsent(account: string | null): void {
  try { localStorage.setItem(key(account), "yes"); } catch { /* Asked again next time; the API still records it. */ }
}
