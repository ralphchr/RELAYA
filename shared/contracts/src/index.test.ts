import { describe, expect, it } from "vitest";
import { ApiErrorSchema, HealthResponseSchema, SessionEventSchema } from "./index.js";

describe("shared contracts", () => {
  it("accepts the documented health response and rejects extra fields", () => {
    expect(HealthResponseSchema.parse({ ok: true, version: "0.1.0" })).toEqual({ ok: true, version: "0.1.0" });
    expect(HealthResponseSchema.safeParse({ ok: true, version: "0.1.0", secret: "x" }).success).toBe(false);
  });

  it("validates the standard API error envelope", () => {
    expect(ApiErrorSchema.safeParse({ error: { code: "RATE_LIMITED", message: "Wait", retryable: true, requestId: "r1" } }).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: { code: "MADE_UP", message: "Wait", retryable: true, requestId: "r1" } }).success).toBe(false);
  });

  it("validates machine events without accepting malformed payloads", () => {
    expect(SessionEventSchema.safeParse({ type: "RECORD_STOP", durationMs: 500 }).success).toBe(true);
    expect(SessionEventSchema.safeParse({ type: "RECORD_STOP", durationMs: -1 }).success).toBe(false);
  });
});
