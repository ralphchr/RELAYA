import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Account } from "../../services/types.js";
import { useServices } from "../../services/ServicesProvider.js";
import { signOut as authSignOut } from "../auth/client.js";

interface AccountContextValue { me: Account | null; loaded: boolean; signOut: () => Promise<void>; refresh: () => void }

const AccountContext = createContext<AccountContextValue>({ me: null, loaded: false, signOut: async () => undefined, refresh: () => undefined });

/** Saving a profile, setting or plan change elsewhere fires this so the shell updates. */
export const ACCOUNT_CHANGED = "relaya:account-changed";
export const accountChanged = () => window.dispatchEvent(new Event(ACCOUNT_CHANGED));

/** Loads the account (profile, settings, plan) and shares it with the shell, pages and panel. */
export function AccountProvider({ children }: { children: ReactNode }) {
  const { account } = useServices();
  const [state, setState] = useState<{ me: Account | null; loaded: boolean }>({ me: null, loaded: false });

  const load = useCallback(() => {
    let active = true;
    account.getMe()
      .then((me) => { if (active) setState({ me, loaded: true }); })
      .catch(() => { if (active) setState({ me: null, loaded: true }); });
    return () => { active = false; };
  }, [account]);

  useEffect(() => {
    const stop = load();
    // Another tab signing in or out changes the stored session.
    const sync = (event: StorageEvent) => { if (event.key === null || event.key.startsWith("relaya.auth")) load(); };
    window.addEventListener("storage", sync);
    const reload = () => { load(); };
    window.addEventListener(ACCOUNT_CHANGED, reload);
    window.addEventListener("relaya:auth-session", reload);
    return () => { stop(); window.removeEventListener("storage", sync); window.removeEventListener(ACCOUNT_CHANGED, reload); window.removeEventListener("relaya:auth-session", reload); };
  }, [load]);

  const signOut = useCallback(async () => {
    await authSignOut();
    sessionStorage.removeItem("relaya.guestPreview");
    load();
  }, [load]);

  const refresh = useCallback(() => { load(); }, [load]);
  const value = useMemo(() => ({ ...state, signOut, refresh }), [state, signOut, refresh]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export const useAccount = () => useContext(AccountContext).me;
export const useAccountLoaded = () => useContext(AccountContext).loaded;
export const useSignOut = () => useContext(AccountContext).signOut;

/** Personal app nickname. Google Meet uses MEET_AGENT_NAME independently. */
export const agentDisplayName = (me: Pick<Account, "firstName" | "agentDisplayName"> | null | undefined) =>
  me?.agentDisplayName?.trim() || (me?.firstName ? `${me.firstName}'s Relaya (AI)` : "Your Relaya (AI)");
