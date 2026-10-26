import type { Page } from "playwright";
import { signedInGoogleAccount } from "../google-account.js";
import { NAME_INPUT } from "./selectors.js";

type IdentityResult = { ok: true } | { ok: false; reason: "bot_name_mismatch" | "bot_name_unverified"; detail: string };

// Google may reject parentheses in an account name. A trailing "AI" still
// identifies the same agent; spelling and the user's name must otherwise match.
const normalized = (name: string) => name.normalize("NFKC").replace(/[’‘]/g, "'")
  .replace(/\s*\(\s*AI\s*\)\s*$/i, " AI").replace(/\s+/g, " ").trim().toLowerCase();
export const sameMeetName = (actual: string, requested: string) => normalized(actual) === normalized(requested);

/** Signed-in Meet uses the Google profile name and offers no per-meeting override. */
export async function prepareMeetIdentity(page: Page, requested: string): Promise<IdentityResult> {
  const field = page.getByRole("textbox", { name: NAME_INPUT }).or(page.getByPlaceholder(NAME_INPUT)).first();
  if (await field.isVisible().catch(() => false)) {
    await field.fill(requested);
    if (await field.inputValue() === requested) return { ok: true };
    return { ok: false, reason: "bot_name_unverified", detail: "Meet didn't keep the requested guest name. The agent hasn't asked to join." };
  }
  const account = await signedInGoogleAccount(page.context());
  if (!account?.name) {
    return { ok: false, reason: "bot_name_unverified", detail: "Couldn't verify the bot's Google profile name. Check its Google sign-in on the agent's laptop, then ask again. The agent hasn't asked to join." };
  }
  if (sameMeetName(account.name, requested)) return { ok: true };
  return {
    ok: false, reason: "bot_name_mismatch",
    detail: `Google Meet would show “${account.name}” instead of “${requested}”. Signed-in Meet uses the Google account's profile name. Change the dedicated bot account's Google name to “${requested}” (a trailing AI without parentheses also works), then ask again. The agent hasn't asked to join.`,
  };
}
