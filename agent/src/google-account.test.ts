import { describe, expect, it } from "vitest";
import { cookieHeaderFor, parseListAccounts } from "./google-account.js";

describe("Google sign-in check", () => {
  it("reads the signed-in account, or none", () => {
    expect(parseListAccounts('["gaia.l.a.r",[]]')).toBeNull();
    expect(parseListAccounts('["gaia.l.a.r",[["gaia.l.a",1,"Relaya AI","relaya.bot@gmail.com","https://photo",1,1,0,null,1,"123"]]]'))
      .toEqual({ name: "Relaya AI", email: "relaya.bot@gmail.com" });
    expect(() => parseListAccounts("<html>")).toThrow();
    expect(() => parseListAccounts('{"accounts":[]}')).toThrow(/Unexpected/);
  });

  it("sends only live cookies for accounts.google.com", () => {
    const now = Date.UTC(2026, 9, 18);
    const cookies = [
      { name: "SID", value: "a", domain: ".google.com", path: "/", expires: now / 1000 + 3600 },
      { name: "LSID", value: "b", domain: "accounts.google.com", path: "/", expires: -1 },
      { name: "OLD", value: "c", domain: ".google.com", path: "/", expires: now / 1000 - 10 },
      { name: "YT", value: "d", domain: ".youtube.com", path: "/", expires: -1 },
      { name: "MEET", value: "e", domain: "meet.google.com", path: "/", expires: -1 },
    ];
    expect(cookieHeaderFor(cookies, now)).toBe("SID=a; LSID=b");
  });
});
