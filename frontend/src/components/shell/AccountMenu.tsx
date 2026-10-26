import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, ChevronRight, ChevronUp, CircleHelp, LogIn, LogOut, Plus, Settings, Sparkles, UserRound } from "lucide-react";
import { copy } from "../../copy/en.js";
import { useAccount, useAccountLoaded, useSignOut } from "../../features/account/AccountProvider.js";
import { UserAvatar } from "./UserAvatar.js";

/** Profile button at the bottom of the sidebar, with the account menu above it. */
export function AccountMenu({ sessionsRemaining }: { sessionsRemaining?: string }) {
  const me = useAccount();
  const accountLoaded = useAccountLoaded();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [confirmAddAccount, setConfirmAddAccount] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const t = copy.shell.account;

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [open]);

  useEffect(() => {
    const dialog = confirmRef.current;
    if (confirmAddAccount && dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    return () => {
      if (!dialog?.open) return;
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    };
  }, [confirmAddAccount]);

  const close = () => { setOpen(false); setAccountsOpen(false); };
  const name = me?.displayName ?? (accountLoaded ? copy.shell.previewUser : "");

  return (
    <div className="account-anchor" ref={ref}>
      {open && (
        <div className="account-pop" id="account-menu" role="menu" aria-label={t.menu}>
          <button className="ap-head ap-switcher" role="menuitem" aria-haspopup="menu" aria-expanded={accountsOpen} aria-controls="account-switcher" onClick={() => setAccountsOpen((value) => !value)}>
            <UserAvatar avatarUrl={me?.avatarUrl} initials={me?.initials ?? "·"} /><span className="ap-head-copy"><b>{name}</b><small>{me?.plan.name ?? t.preview}</small></span><ChevronRight className="icon ap-switch-chevron" aria-hidden="true" />
          </button>
          {accountsOpen && <div className="ap-account-pop" id="account-switcher" role="menu" aria-label="Account switcher">
            <div className="ap-email"><span className="ap-email-icon" aria-hidden="true">@</span><span>{me?.email ?? t.preview}</span></div>
            <div className="ap-div" />
            <div className="ap-current"><UserAvatar avatarUrl={me?.avatarUrl} initials={me?.initials ?? "·"} className="ap-mini-av" /><span>{me?.signedIn ? "Personal account" : t.preview}</span><Check className="icon" aria-hidden="true" /></div>
            <button className="ap-add-account" role="menuitem" type="button" onClick={() => setConfirmAddAccount(true)}><Plus className="icon" />Add account</button>
          </div>}
          <div className="ap-div" />
          <Link role="menuitem" to="/billing" onClick={close}><Sparkles className="icon" />{copy.shell.plan.upgrade}</Link>
          <Link role="menuitem" aria-label={t.profile} to="/profile" onClick={close}><UserRound className="icon" />{t.profile}</Link>
          <Link role="menuitem" to="/settings" onClick={close}><Settings className="icon" />Settings</Link>
          <div className="ap-div" />
          <Link role="menuitem" to="/help" onClick={close}><CircleHelp className="icon" />{t.help}</Link>
          <div className="ap-div" />
          {me?.signedIn
            ? <button role="menuitem" className="ap-signout" onClick={() => { close(); void signOut().then(() => navigate("/login")); }}><LogOut className="icon" />{copy.shell.signOut}</button>
            : <Link role="menuitem" className="ap-signout" to="/login" onClick={close}><LogIn className="icon" />{copy.shell.signIn}</Link>}
        </div>
      )}
      {confirmAddAccount && <dialog ref={confirmRef} className="account-confirm" aria-labelledby="add-account-title" onCancel={(event) => { event.preventDefault(); setConfirmAddAccount(false); }}>
        <h2 id="add-account-title">{t.addAccountTitle}</h2>
        <p>{t.addAccountMessage}</p>
        <div className="row-end">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmAddAccount(false)}>{copy.common.cancel}</button>
          <button type="button" className="btn btn-coral" autoFocus onClick={() => { setConfirmAddAccount(false); close(); void signOut().then(() => navigate("/login")); }}>{t.addAccountConfirm}</button>
        </div>
      </dialog>}
      <button className={`me${open ? " open" : ""}`} aria-label={name || "Account menu"} aria-haspopup="menu" aria-expanded={open} aria-controls="account-menu" onClick={() => setOpen((value) => !value)}>
        <UserAvatar avatarUrl={me?.avatarUrl} initials={me?.initials ?? (accountLoaded ? "·" : "")} ready={accountLoaded} />
        <div className={`me-text${accountLoaded ? " is-ready" : ""}`}><b>{name}</b><small>{me?.plan.name ?? ""}{sessionsRemaining && <><span className="me-plan-separator"> · </span>{sessionsRemaining}</>}</small></div>
        <ChevronUp className="icon me-chev" aria-hidden="true" />
      </button>
    </div>
  );
}
