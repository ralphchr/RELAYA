import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { signedInGoogleAccount } from "../google-account.js";
import { prepareMeetIdentity, sameMeetName } from "./identity.js";

vi.mock("../google-account.js", () => ({ signedInGoogleAccount: vi.fn() }));
const requested = "RELAYA AI";
function fakePage(guest = false, keptName = requested) {
  const field = { isVisible: vi.fn(async () => guest), fill: vi.fn(), inputValue: vi.fn(async () => keptName), or: () => field, first: () => field };
  const page = { getByRole: () => field, getByPlaceholder: () => field, context: () => ({}) } as unknown as Page;
  return { page, field };
}
beforeEach(() => vi.mocked(signedInGoogleAccount).mockReset());

describe("Meet identity", () => {
  it("sets and verifies a guest name", async () => {
    const { page, field } = fakePage(true);
    expect(await prepareMeetIdentity(page, requested)).toEqual({ ok: true });
    expect(field.fill).toHaveBeenCalledWith(requested);
    expect(signedInGoogleAccount).not.toHaveBeenCalled();
  });
  it("rejects a guest name that Meet didn't keep", async () => {
    expect(await prepareMeetIdentity(fakePage(true, "Demo").page, requested)).toMatchObject({ ok: false, reason: "bot_name_unverified" });
  });
  it.each([requested, "RELAYA (AI)"])("accepts the matching signed-in profile %s", async (name) => {
    vi.mocked(signedInGoogleAccount).mockResolvedValue({ name, email: "bot@example.test" });
    expect(await prepareMeetIdentity(fakePage().page, requested)).toEqual({ ok: true });
  });
  it("explains an unrelated Google profile before joining", async () => {
    vi.mocked(signedInGoogleAccount).mockResolvedValue({ name: "Demo Account", email: "bot@example.test" });
    expect(await prepareMeetIdentity(fakePage().page, requested)).toMatchObject({ ok: false, reason: "bot_name_mismatch", detail: expect.stringContaining("Demo Account") });
  });
  it("doesn't assume an unavailable identity matches", async () => {
    vi.mocked(signedInGoogleAccount).mockResolvedValue(null);
    expect(await prepareMeetIdentity(fakePage().page, requested)).toMatchObject({ ok: false, reason: "bot_name_unverified" });
  });
  it("requires the complete requested name, including the AI label", () => {
    expect(sameMeetName("RELAYA", requested)).toBe(false);
    expect(sameMeetName("Someone's Relaya AI", requested)).toBe(false);
  });
});
