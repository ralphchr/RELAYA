import { getSession, isAuthConfigured } from "../features/auth/client.js";
import { loadLocalProfile, loadLocalSettings, localData } from "./localData.js";
import { formatResetDate, loadSupabaseAccountData, supabaseData } from "./supabaseData.js";
import type { Account, AccountService, Plan, UserDataService } from "./types.js";

/** Signed in with Supabase configured: the account lives in the database. */
export const usesSupabase = () => isAuthConfigured() && Boolean(getSession()?.access_token);

/** Picks Supabase or this browser on every call, so signing in or out switches it. */
export const userData: UserDataService = new Proxy({} as UserDataService, {
  get: (_target, key: keyof UserDataService) => (usesSupabase() ? supabaseData : localData)[key],
});

function nextMonthStart() {
  const now = new Date();
  return formatResetDate(new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString());
}

/** Shown when the plan can't be read (preview, or the database isn't set up). */
const PREVIEW_PLAN: Plan = { name: "Free plan", agentSessionsLeft: 8, agentSessionsTotal: 8, agentMinutesLeft: 240, sentencesLeft: 60, sentencesTotal: 60, resetsOn: nextMonthStart() };

export const account: AccountService = {
  async getMe(): Promise<Account> {
    const session = getSession();
    const user = session?.user;
    const signedIn = Boolean(session?.access_token);
    const metaName = user?.user_metadata?.full_name?.trim() || user?.user_metadata?.name?.trim() || "";

    let saved: Awaited<ReturnType<typeof loadSupabaseAccountData>> | null = null;
    if (usesSupabase()) saved = await loadSupabaseAccountData().catch(() => null);
    const local = saved ? null : loadLocalProfile();

    const name = saved?.displayName?.trim() || local?.displayName?.trim() || metaName;
    const firstName = name.split(/\s+/)[0] ?? "";
    return {
      displayName: name || (signedIn ? "Relaya member" : "Preview user"),
      firstName,
      initials: (firstName || (signedIn ? "R" : "P")).slice(0, 1).toUpperCase(),
      avatarUrl: saved?.avatarUrl ?? local?.avatarUrl ?? null,
      email: user?.email ?? null,
      phone: user?.phone ?? null,
      signedIn,
      agentDisplayName: saved ? saved.agentDisplayName : local?.agentDisplayName ?? null,
      settings: saved?.settings ?? (signedIn && isAuthConfigured() ? { ...loadLocalSettings(), gender: null } : loadLocalSettings()),
      plan: saved?.plan ?? PREVIEW_PLAN,
    };
  },
};
