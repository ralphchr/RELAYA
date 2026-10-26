import { afterEach, describe, expect, it, vi } from "vitest";
import { httpSessions } from "./httpSessions.js";

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe("http sessions", () => {
  it("sends the end right away, as a request that outlives a closing tab", () => {
    localStorage.setItem("relaya.auth.session", JSON.stringify({ access_token: "t", refresh_token: "r" }));
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    void httpSessions.end("0b6f2c1e-1111-4222-8333-444455556666", { approved: 2, edited: 1, usedAsIs: 0, rerecords: 1 });
    // Called synchronously: nothing to wait for while the page unloads.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/sessions\/0b6f2c1e-1111-4222-8333-444455556666\/end$/);
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body))).toEqual({ approved: 2, edited: 1, usedAsIs: 0, rerecords: 1 });
  });
});
