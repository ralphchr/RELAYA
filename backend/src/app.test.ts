import { describe, expect, it } from "vitest";
import app from "./app.js";

describe("API foundation", () => {
  it("exposes the versioned health check", async () => {
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: "0.1.0" });
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("returns the documented error envelope for unknown routes", async () => {
    const response = await app.request("/api/not-a-route");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND", retryable: false } });
  });

  it("requires sign-in to rebuild a corrected transcript", async () => {
    const response = await app.request("/api/reconstruct/text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: "Corrected words", tone: "professional", names: [] }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("restricts cross-origin requests to configured origins", async () => {
    const allowed = await app.request("/api/health", { headers: { Origin: "http://localhost:5173" } });
    const denied = await app.request("/api/health", { headers: { Origin: "https://attacker.example" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});
