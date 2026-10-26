import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { prepareMeetIdentity } from "./identity.js";
import { joinMeet } from "./join.js";
import * as S from "./selectors.js";

vi.mock("./identity.js", () => ({ prepareMeetIdentity: vi.fn() }));

describe("joining with the requested identity", () => {
  it.each(["bot_name_mismatch", "bot_name_unverified"] as const)("stops %s before asking the host, without retrying", async (reason) => {
    const click = vi.fn();
    const locator = (visible: boolean) => {
      const result = { isVisible: async () => visible, first: () => result, or: () => result, click };
      return result;
    };
    const goto = vi.fn();
    const page = {
      goto,
      getByRole: (_role: string, options: { name: RegExp }) => locator(options.name === S.JOIN_BUTTON),
      getByText: () => locator(false), getByPlaceholder: () => locator(false),
    } as unknown as Page;
    vi.mocked(prepareMeetIdentity).mockResolvedValue({ ok: false, reason, detail: "Check the bot profile." });
    const statuses = vi.fn();
    expect(await joinMeet(page, { url: "https://meet.google.com/abc-defg-hij", displayName: "Dana's Relaya (AI)", onStatus: statuses }))
      .toEqual({ outcome: "failed", reason, detail: "Check the bot profile.", attempts: 1 });
    expect(goto).toHaveBeenCalledTimes(1);
    expect(prepareMeetIdentity).toHaveBeenCalledWith(page, "RELAYA AI");
    expect(click).not.toHaveBeenCalled();
    expect(statuses).not.toHaveBeenCalledWith("waiting_host");
  });
});
