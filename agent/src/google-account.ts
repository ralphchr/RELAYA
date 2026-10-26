import { existsSync, readFileSync } from "node:fs";
import { SESSION_FILE } from "./browser.js";
import type { BrowserContext } from "playwright";

/*
 * Is the bot's saved Google sign-in still good? Google's ListAccounts answers
 * with the signed-in accounts for the cookies it gets, or an empty list when
 * they're expired or revoked. No browser needed, so it's quick enough to run
 * at startup and whenever Meet turns the bot away.
 */
const LIST_ACCOUNTS = "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard";

export type GoogleSignIn =
  | { state: "signed_in"; name: string | null; email: string | null }
  | { state: "signed_out" }
  | { state: "missing" }
  | { state: "unknown"; reason: string };

/** `["gaia.l.a.r", [["gaia.l.a", 1, name, email, ...], ...]]`. Null when no account is signed in. */
export function parseListAccounts(text: string): { name: string | null; email: string | null } | null {
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data) || data[0] !== "gaia.l.a.r" || !Array.isArray(data[1])) throw new Error("Unexpected ListAccounts reply.");
  const first = (data[1] as unknown[])[0];
  if (!Array.isArray(first)) return null;
  const text_ = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return { name: text_(first[2]), email: text_(first[3]) };
}

/** Read the identity from this browser context, rather than a stale saved session. */
export async function signedInGoogleAccount(context: Pick<BrowserContext, "request">) {
  try {
    const response = await context.request.post(LIST_ACCOUNTS, { timeout: 8000 });
    return response.ok() ? parseListAccounts(await response.text()) : null;
  } catch { return null; }
}

interface SavedCookie { name: string; value: string; domain: string; path: string; expires: number }

/** The Cookie header a browser would send to accounts.google.com. */
export function cookieHeaderFor(cookies: SavedCookie[], now = Date.now()): string {
  return cookies
    .filter((c) => (c.domain === ".google.com" || c.domain === "accounts.google.com" || c.domain === ".accounts.google.com") && c.path === "/")
    .filter((c) => c.expires <= 0 || c.expires * 1000 > now)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/** Ask Google whether the saved cookies still sign the bot in. */
export async function checkGoogleSignIn(file = SESSION_FILE): Promise<GoogleSignIn> {
  if (!existsSync(file)) return { state: "missing" };
  try {
    const { cookies } = JSON.parse(readFileSync(file, "utf8")) as { cookies: SavedCookie[] };
    const cookie = cookieHeaderFor(cookies);
    if (!cookie) return { state: "signed_out" };
    const response = await fetch(LIST_ACCOUNTS, { method: "POST", headers: { Cookie: cookie }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return { state: "unknown", reason: `Google answered ${response.status}` };
    const account = parseListAccounts(await response.text());
    return account ? { state: "signed_in", ...account } : { state: "signed_out" };
  } catch (error) {
    return { state: "unknown", reason: error instanceof Error ? error.message : String(error) };
  }
}

export const describeAccount = (a: { name: string | null; email: string | null }) =>
  [a.name, a.email && `(${a.email})`].filter(Boolean).join(" ") || "the bot's Google account";
