import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A fake signed-in user. The token's payload carries sub = user-1.
const token = `x.${btoa(JSON.stringify({ sub: "user-1" }))}.y`;

describe("browser storage (preview)", () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });

  it("carries over lists saved by the old Names page, and keeps one default", async () => {
    localStorage.setItem("relaya.savedNames.v1", JSON.stringify([{ id: "a", name: "Clients", items: ["Ma. Cristina", "Davao"] }, { id: "b", name: "Team", items: [] }]));
    const { localData } = await import("./localData.js");
    const lists = await localData.nameLists();
    expect(lists.map((l) => [l.title, l.isDefault, l.items.map((i) => i.value)])).toEqual([["Clients", true, ["Ma. Cristina", "Davao", "Relaya"]], ["Team", false, []]]);
    await localData.setDefaultList("b");
    expect((await localData.nameLists()).filter((l) => l.isDefault).map((l) => l.id)).toEqual(["b"]);
  });

  it("adds, rejects repeats, reorders and removes names", async () => {
    const { localData } = await import("./localData.js");
    const [list] = await localData.nameLists();
    expect(list?.title).toBe("Default Glossary");
    expect(list?.items.map((item) => item.value)).toEqual(["Relaya"]);
    await localData.addNames(list!.id, ["Ana", "Ben", "Cebu"]);
    await expect(localData.addNames(list!.id, ["ana"])).rejects.toThrow(/already/);
    await expect(localData.addNames(list!.id, Array.from({ length: 28 }, (_, i) => `N${i}`))).rejects.toThrow(/30/);
    const items = (await localData.nameLists())[0]!.items;
    await localData.reorderNames(list!.id, [items[3]!.id, items[1]!.id, items[2]!.id, items[0]!.id]);
    await localData.removeName(items[1]!.id);
    expect((await localData.nameLists())[0]!.items.map((i) => [i.value, i.position])).toEqual([["Cebu", 0], ["Ben", 2], ["Relaya", 3]]);
  });

  it("keeps a session history with counts", async () => {
    const { localData, localSessions } = await import("./localData.js");
    const id = localSessions.start({ mode: "say", tone: "casual", names: ["Davao"], meetingUrl: null, title: "Say it yourself · Oct 17" });
    localSessions.end(id, { approved: 3, edited: 1, usedAsIs: 0, rerecords: 2 });
    expect(await localData.recentSessions(5)).toEqual([expect.objectContaining({ id, status: "ended", approved: 3, rerecords: 2 })]);
    expect((await localData.recentSessions(5))[0]).not.toHaveProperty("names");
    expect((await localData.session(id))?.names).toEqual(["Davao"]);
    await localData.deleteSession(id);
    expect(await localData.recentSessions(5)).toEqual([]);
  });

  it("reads old preferences into settings", async () => {
    localStorage.setItem("relaya.preferences.v1", JSON.stringify({ mode: "speak", tone: "casual" }));
    const { loadLocalSettings } = await import("./localData.js");
    expect(loadLocalSettings()).toMatchObject({ defaultMode: "speak", defaultTone: "casual", voiceId: "af_heart" });
  });
});

describe("Supabase (signed in)", () => {
  let calls: { method: string; url: string; body: unknown; prefer: string | null; auth: string | null }[];
  let reply: (url: string, method: string) => unknown;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "https://db.test");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
    localStorage.setItem("relaya.auth.session", JSON.stringify({ access_token: token, refresh_token: "r", expires_at: Date.now() / 1000 + 3600, user: { id: "user-1" } }));
    calls = [];
    reply = () => [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      const method = init.method ?? "GET";
      calls.push({ method, url: decodeURIComponent(url.replace("https://db.test/rest/v1/", "")), body: init.body ? JSON.parse(String(init.body)) : null, prefer: headers.get("Prefer"), auth: headers.get("Authorization") });
      const value = reply(url, method);
      return value === null ? new Response(null, { status: 204 }) : new Response(JSON.stringify(value), { status: method === "POST" ? 201 : 200 });
    }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); localStorage.clear(); });

  it("reads lists with their names in order, as the user", async () => {
    reply = () => [{ id: "l1", title: "My names", is_default: true, name_list_items: [{ id: "i1", value: "Davao", position: 0 }] }];
    const { supabaseData } = await import("./supabaseData.js");
    expect(await supabaseData.nameLists()).toEqual([{ id: "l1", title: "My names", isDefault: true, items: [{ id: "i1", value: "Davao", position: 0 }] }]);
    expect(calls[0]).toMatchObject({ url: "name_lists?select=id,title,is_default,name_list_items(id,value,position)&order=created_at.asc&name_list_items.order=position.asc", auth: `Bearer ${token}` });
  });

  it("appends names after the last position", async () => {
    reply = (url, method) => (method === "GET" ? [{ position: 4 }] : [{ id: "n", value: "Ana", position: 5 }]);
    const { supabaseData } = await import("./supabaseData.js");
    await supabaseData.addNames("l1", ["Ana", "Ben"]);
    expect(calls[1]).toMatchObject({ method: "POST", url: "name_list_items?select=id,value,position", prefer: "return=representation",
      body: [{ list_id: "l1", value: "Ana", position: 5 }, { list_id: "l1", value: "Ben", position: 6 }] });
  });

  it("creates lists for the signed-in user and switches the default in order", async () => {
    reply = (url, method) => (method === "POST" ? [{ id: "l2", title: "Clients", is_default: false }] : null);
    const { supabaseData } = await import("./supabaseData.js");
    await supabaseData.createList("Clients");
    expect(calls[0]?.body).toEqual({ user_id: "user-1", title: "Clients" });
    await supabaseData.setDefaultList("l2");
    expect(calls.slice(1).map((c) => [c.method, c.url, c.body])).toEqual([
      ["PATCH", "name_lists?is_default=is.true", { is_default: false }],
      ["PATCH", "name_lists?id=eq.l2", { is_default: true }],
    ]);
  });

  it("maps settings both ways", async () => {
    reply = () => null;
    const { supabaseData } = await import("./supabaseData.js");
    await supabaseData.updateSettings({ voiceId: "bm_george", gender: "male", voiceSpeed: 1.1, defaultTone: "casual", languageMode: "bisaya_english" });
    expect(calls[0]).toMatchObject({ method: "PATCH", url: "user_settings?user_id=eq.user-1", body: { voice_id: "bm_george", gender: "male", voice_speed: 1.1, default_tone: "casual", language_mode: "bisaya_english" } });
  });

  it("turns a duplicate-name error into a plain message", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => (init.method === "POST"
      ? new Response(JSON.stringify({ code: "23505", message: "duplicate key value violates unique constraint" }), { status: 409 })
      : new Response("[]", { status: 200 }))));
    const { supabaseData } = await import("./supabaseData.js");
    await expect(supabaseData.addNames("l1", ["Ana"])).rejects.toThrow("That name is already on the list.");
  });

  it("loads the plan from the usage view", async () => {
    reply = (url) => url.includes("v_usage_current")
      ? [{ plan_id: "free", period_end: "2026-11-15T00:00:00Z", agent_sessions_left: 5, agent_sessions_total: 8, agent_seconds_left: 7200, reconstructions_used: 12, reconstructions_left: 48 }]
      : url.includes("profiles") ? [{ display_name: "Angel Ranario", agent_display_name: "Angel's Relaya AI" }] : [];
    const { loadSupabaseAccountData } = await import("./supabaseData.js");
    const account = await loadSupabaseAccountData();
    expect(account.plan).toMatchObject({ name: "Free plan", agentSessionsLeft: 5, agentSessionsTotal: 8, agentMinutesLeft: 120, sentencesLeft: 48, sentencesTotal: 60 });
    expect(account.agentDisplayName).toBe("Angel's Relaya AI");
    expect(account.settings.voiceId).toBe("af_heart");
    expect(account.settings.languageMode).toBe("auto");
  });

  it.each(["bisaya_english", "japanese_english", "mandarin_english", "spanish_english"] as const)("saves and reloads the %s preference", async (mode) => {
    let savedMode: string = "auto";
    reply = (url, method) => {
      if (!url.includes("user_settings")) return [];
      if (method === "PATCH") {
        savedMode = (calls.at(-1)?.body as { language_mode: string }).language_mode;
        return null;
      }
      return [{ default_mode: "say", default_tone: "professional", language_mode: savedMode, voice_id: "af_heart", gender: null, voice_speed: 1, ptt_key: "Space", email_product_updates: true, email_quota_warnings: true }];
    };
    const { loadSupabaseAccountData, supabaseData } = await import("./supabaseData.js");
    await supabaseData.updateSettings({ languageMode: mode });
    const account = await loadSupabaseAccountData();
    expect(account.settings.languageMode).toBe(mode);
  });
});
