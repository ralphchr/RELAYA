import type { ReactNode } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { useAccount } from "../account/AccountProvider.js";

export function PageIntro({ eyebrow, title, text, action }: { eyebrow?: string; title: string; text: string; action?: ReactNode }) {
  return <div className="workspace-intro">{eyebrow && <p className="workspace-eyebrow">{eyebrow}</p>}<div className="workspace-intro-row"><div><h2>{title}</h2><p>{text}</p></div>{action}</div></div>;
}

/** A save result: green when it worked, red when it didn't. */
export function SavedNote({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={`workspace-note${error ? " error" : ""}`} role={error ? "alert" : "status"}>{error ? <TriangleAlert size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}{children}</p>;
}

/** Shown in the preview workspace, where data stays in this browser. */
export function StorageNote() {
  const me = useAccount();
  if (me?.signedIn) return null;
  return <p className="workspace-local-note">You're in the preview workspace, so this is saved in this browser only. Sign in to keep it in your account.</p>;
}

export const errorMessage = (error: unknown) => (error instanceof Error && error.message ? error.message : "Couldn't save that. Try again.");
