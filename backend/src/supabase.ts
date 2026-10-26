/**
 * Server-side Supabase calls with the service role key. Never imported by the web app.
 */
export class SupabaseUnavailable extends Error {}

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new SupabaseUnavailable("Supabase is not configured.");
  return { url, key };
}

async function call(path: string, init: RequestInit & { userToken?: string } = {}): Promise<Response> {
  const { url, key } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetch(`${url}${path}`, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${init.userToken ?? key}`, "Content-Type": "application/json", ...init.headers },
      signal: controller.signal,
    });
  } catch {
    throw new SupabaseUnavailable("Supabase is temporarily unavailable.");
  } finally {
    clearTimeout(timer);
  }
}

/** The signed-in user's id, or null when the token is missing, expired or invalid. */
export async function userFromToken(token: string): Promise<{ id: string } | null> {
  const response = await call("/auth/v1/user", { userToken: token });
  if (!response.ok) return null;
  const user = (await response.json().catch(() => null)) as { id?: unknown } | null;
  return typeof user?.id === "string" ? { id: user.id } : null;
}

/** GET /rest/v1/<path>, returns rows. */
export async function select<T>(path: string): Promise<T[]> {
  const response = await call(`/rest/v1/${path}`);
  if (!response.ok) throw new SupabaseUnavailable(`Supabase select failed (${response.status}).`);
  return (await response.json()) as T[];
}

/** A user-scoped read: PostgREST verifies the token and applies row-level security. */
export async function selectAsUser<T>(path: string, token: string): Promise<T[]> {
  const response = await call(`/rest/v1/${path}`, { userToken: token });
  if (!response.ok) throw new SupabaseUnavailable(`Supabase user select failed (${response.status}).`);
  return (await response.json()) as T[];
}

export async function update(path: string, values: Record<string, unknown>): Promise<void> {
  const response = await call(`/rest/v1/${path}`, { method: "PATCH", body: JSON.stringify(values), headers: { Prefer: "return=minimal" } });
  if (!response.ok) throw new SupabaseUnavailable(`Supabase update failed (${response.status}).`);
}

export async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await call(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
  if (!response.ok) throw new SupabaseUnavailable(`Supabase rpc ${name} failed (${response.status}).`);
  return (await response.json()) as T;
}

/** POST /rest/v1/<path>, returns the inserted rows. */
export async function insert<T>(path: string, rows: unknown): Promise<T[]> {
  const response = await call(`/rest/v1/${path}`, { method: "POST", body: JSON.stringify(rows), headers: { Prefer: "return=representation" } });
  if (!response.ok) throw new SupabaseUnavailable(`Supabase insert failed (${response.status}).`);
  return (await response.json()) as T[];
}
