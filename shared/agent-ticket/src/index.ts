/**
 * The API's permission slip for one agent join. The API signs it after it
 * checks the user's login and plan; the agent checks the signature before it
 * opens a browser. Both sides share AGENT_TICKET_SECRET. WebCrypto only, so it
 * runs the same in Node and in tests.
 */
export interface AgentTicket {
  v: 1;
  /** Supabase user id. */
  sub: string;
  meetingUrl: string;
  /** How long the agent may stay in the meeting. */
  maxSeconds: number;
  /** Expiry, seconds since epoch. The agent must be asked to join before this. */
  exp: number;
  /** Unique id, so a ticket works once. */
  jti: string;
}

export class TicketError extends Error {
  constructor(readonly reason: "malformed" | "signature" | "expired") { super(`Invalid agent ticket (${reason}).`); }
}

export const TICKET_TTL_SECONDS = 120;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  if (secret.length < 32) throw new Error("AGENT_TICKET_SECRET must be at least 32 characters.");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

export async function signTicket(input: Omit<AgentTicket, "v" | "exp" | "jti">, secret: string, now = Date.now()): Promise<{ ticket: string; claims: AgentTicket }> {
  const claims: AgentTicket = { v: 1, ...input, exp: Math.floor(now / 1000) + TICKET_TTL_SECONDS, jti: crypto.randomUUID() };
  const body = toBase64Url(encoder.encode(JSON.stringify(claims)));
  return { ticket: `${body}.${toBase64Url(await hmac(secret, body))}`, claims };
}

export async function verifyTicket(ticket: string, secret: string, now = Date.now()): Promise<AgentTicket> {
  const [body, signature, extra] = ticket.split(".");
  if (!body || !signature || extra !== undefined) throw new TicketError("malformed");

  const expected = await hmac(secret, body);
  let given: Uint8Array;
  try { given = fromBase64Url(signature); } catch { throw new TicketError("malformed"); }
  // Constant-time compare.
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= expected[i]! ^ (given[i] ?? 0);
  if (diff !== 0) throw new TicketError("signature");

  let claims: unknown;
  try { claims = JSON.parse(new TextDecoder().decode(fromBase64Url(body))); } catch { throw new TicketError("malformed"); }
  if (!isTicket(claims)) throw new TicketError("malformed");
  if (claims.exp * 1000 <= now) throw new TicketError("expired");
  return claims;
}

function isTicket(value: unknown): value is AgentTicket {
  const t = value as Partial<AgentTicket> | null;
  return !!t && t.v === 1 && typeof t.sub === "string" && typeof t.meetingUrl === "string" && typeof t.jti === "string"
    && Number.isInteger(t.maxSeconds) && t.maxSeconds! > 0 && Number.isInteger(t.exp);
}
