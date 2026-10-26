export type AuthMethod = "email";
export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id: string; email?: string; phone?: string; user_metadata?: { full_name?: string; name?: string } };
};

const SESSION_KEY = "relaya.auth.session";
const VERIFIER_KEY = "relaya.auth.pkce_verifier";
const AUTH_REQUEST_TIMEOUT_MS = 15_000;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export class AuthClientError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AuthClientError";
  }
}

export function isAuthConfigured() {
  return Boolean(supabaseUrl && supabaseKey);
}

function requireConfig() {
  if (!supabaseUrl || !supabaseKey) {
    throw new AuthClientError("Authentication isn't configured yet. Add the Supabase project URL and public anon key to the web app environment.");
  }
  return { url: supabaseUrl, key: supabaseKey };
}

async function authRequest<T>(path: string, body?: object, redirectTo?: string): Promise<T> {
  const { url, key } = requireConfig();
  const endpoint = new URL(`${url}/auth/v1/${path}`);
  if (redirectTo) endpoint.searchParams.set("redirect_to", redirectTo);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: body ? "POST" : "GET",
      headers: { apikey: key, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AuthClientError("Supabase sign-in took too long to respond. Check your connection and try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => ({})) as { msg?: string; message?: string; error_description?: string; error?: string };
  if (!response.ok) {
    throw new AuthClientError(payload.msg ?? payload.message ?? payload.error_description ?? payload.error ?? "We couldn't complete sign-in. Please try again.", response.status);
  }
  return payload as T;
}

export async function sendOtp(method: AuthMethod, address: string) {
  if (method === "email") {
    const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(64)));
    const challenge = toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    localStorage.setItem(VERIFIER_KEY, verifier);
    try {
      await authRequest("otp", {
        email: address,
        create_user: true,
        data: {},
        code_challenge: challenge,
        code_challenge_method: "s256",
      }, `${window.location.origin}/auth/callback`);
    } catch (error) {
      localStorage.removeItem(VERIFIER_KEY);
      throw error;
    }
    return;
  }
}

export async function verifyOtp(method: AuthMethod, address: string, token: string) {
  const session = await authRequest<AuthSession>("verify", { email: address, token, type: "email" });
  requireSession(session);
  saveSession(session);
  localStorage.removeItem(VERIFIER_KEY);
  return session;
}

/** Sign in with an existing email/password account, or create one when requested. */
export async function signInWithPassword(email: string, password: string) {
  const session = await authRequest<AuthSession>("token?grant_type=password", { email, password });
  requireSession(session);
  saveSession(session);
  return session;
}

export async function signUpWithPassword(email: string, password: string, profile: { fullName: string; dateOfBirth: string; gender: "male" | "female" }) {
  const redirect = new URL("/auth/callback", window.location.origin);
  redirect.searchParams.set("next", "/email-confirmed");
  const result = await authRequest<AuthSession & { id?: string; email?: string }>("signup", {
    email,
    password,
    data: { full_name: profile.fullName, date_of_birth: profile.dateOfBirth, gender: profile.gender },
  }, redirect.toString());
  if (result.access_token && result.refresh_token) {
    saveSession(result);
    return { needsEmailConfirmation: false };
  }
  return { needsEmailConfirmation: true };
}

export async function requestPasswordReset(email: string) {
  const redirect = new URL("/auth/callback", window.location.origin);
  redirect.searchParams.set("next", "/login?reset=1");
  await authRequest("recover", { email }, redirect.toString());
}

export async function updatePassword(password: string) {
  const session = getSession();
  if (!session?.access_token) throw new AuthClientError("Your password reset session expired. Request a new reset email.");
  const { url, key } = requireConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string; message?: string };
    throw new AuthClientError(payload.msg ?? payload.message ?? "We couldn't update your password. Please try again.", response.status);
  }
}

export async function verifyEmailTokenHash(tokenHash: string, type: "email" | "signup" | "magiclink" = "email") {
  const session = await authRequest<AuthSession>("verify", { token_hash: tokenHash, type });
  requireSession(session);
  saveSession(session);
  localStorage.removeItem(VERIFIER_KEY);
  return session;
}

export async function signInWithProvider(provider: "google" | "facebook") {
  const { url, key } = requireConfig();
  const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(64)));
  const challenge = toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  localStorage.setItem(VERIFIER_KEY, verifier);
  const redirect = new URL("/auth/callback", window.location.origin);
  const authorize = new URL(`${url}/auth/v1/authorize`);
  authorize.searchParams.set("provider", provider);
  authorize.searchParams.set("redirect_to", redirect.toString());
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "s256");
  authorize.searchParams.set("apikey", key);
  window.location.assign(authorize.toString());
}

export async function completeOAuthCallback(code: string) {
  const verifier = localStorage.getItem(VERIFIER_KEY) ?? sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw new AuthClientError("This sign-in link has expired. Please try signing in again.");
  const session = await authRequest<AuthSession>("token?grant_type=pkce", { auth_code: code, code_verifier: verifier });
  localStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  saveSession(session);
  return session;
}

export function saveSession(session: AuthSession) {
  requireSession(session);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, expires_at: session.expires_at ?? (session.expires_in ? Date.now() / 1000 + Number(session.expires_in) : undefined) }));
  if (getSession()?.access_token !== session.access_token) {
    throw new AuthClientError("Supabase verified the code, but this browser couldn't save the sign-in session. Check browser storage settings and try again.");
  }
  sessionStorage.removeItem("relaya.guestPreview");
  window.dispatchEvent(new Event("relaya:auth-session"));
}

export function completeImplicitCallback(params: URLSearchParams) {
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) {
    throw new AuthClientError("This sign-in link is invalid or has expired. Please request a fresh code.");
  }
  let user: AuthSession["user"];
  const serializedUser = params.get("user");
  if (serializedUser) {
    try {
      user = JSON.parse(serializedUser) as AuthSession["user"];
    } catch {
      // A valid access and refresh token are enough to restore the session.
    }
  }
  const session: AuthSession = {
    access_token: accessToken,
    refresh_token: refreshToken,
    ...(Number(params.get("expires_in")) > 0 ? { expires_in: Number(params.get("expires_in")) } : {}),
    ...(Number(params.get("expires_at")) > 0 ? { expires_at: Number(params.get("expires_at")) } : {}),
    ...(user ? { user } : {}),
  };
  saveSession(session);
  localStorage.removeItem(VERIFIER_KEY);
  return session;
}

export function getSession(): AuthSession | null {
  try {
    const value = localStorage.getItem(SESSION_KEY);
    return value ? JSON.parse(value) as AuthSession : null;
  } catch {
    return null;
  }
}

/** True only for the explicit, signed-out preview flow (never an expired account session). */
export function isGuestPreview() {
  try { return !getSession()?.access_token && sessionStorage.getItem("relaya.guestPreview") === "1"; }
  catch { return false; }
}

/** Refresh before the access token expires; Supabase rotates refresh tokens. */
export async function refreshSession() {
  const session = getSession();
  if (!session?.refresh_token || !isAuthConfigured()) return session;
  const refreshed = await authRequest<AuthSession>("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
  requireSession(refreshed);
  saveSession(refreshed);
  return refreshed;
}

/** Restore a saved session and refresh it when it is close to expiry. */
export async function restoreSession() {
  const session = getSession();
  if (!session || !isAuthConfigured() || !session.refresh_token) return session;
  if (!session.expires_at || session.expires_at * 1000 > Date.now() + 60_000) return session;
  try {
    return await refreshSession();
  } catch (error) {
    if (error instanceof AuthClientError && (error.status === 400 || error.status === 401)) {
      clearSession();
      return null;
    }
    throw error;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event("relaya:auth-session"));
}

export async function signOut() {
  const session = getSession();
  if (session?.access_token && isAuthConfigured()) {
    try {
      const { url, key } = requireConfig();
      await fetch(`${url}/auth/v1/logout`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${session.access_token}` } });
    } catch {
      // Clear the local session even if the network is unavailable.
    } finally { clearSession(); }
  } else {
    clearSession();
  }
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function requireSession(value: AuthSession | null | undefined): asserts value is AuthSession {
  if (!value?.access_token || !value.refresh_token) {
    throw new AuthClientError("The code was accepted, but Supabase didn't return a login session. Check the email OTP setup in Supabase, then request a fresh code.");
  }
}
