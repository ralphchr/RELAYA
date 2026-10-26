import { describe, expect, it } from "vitest";
import { signTicket, TicketError, verifyTicket } from "./index.js";

const SECRET = "test-secret-that-is-long-enough-1234";
const input = { sub: "user-1", meetingUrl: "https://meet.google.com/abc-defg-hij", maxSeconds: 1800 };

describe("agent tickets", () => {
  it("round-trips the claims", async () => {
    const { ticket, claims } = await signTicket(input, SECRET);
    expect(await verifyTicket(ticket, SECRET)).toEqual(claims);
    expect(claims).toMatchObject(input);
  });

  it("rejects a different secret, a tampered body and an expired ticket", async () => {
    const now = Date.now();
    const { ticket } = await signTicket(input, SECRET, now);
    await expect(verifyTicket(ticket, `${SECRET}x`)).rejects.toMatchObject({ reason: "signature" });

    const [body, signature] = ticket.split(".");
    const forged = btoa(JSON.stringify({ ...JSON.parse(atob(body!.replace(/-/g, "+").replace(/_/g, "/"))), maxSeconds: 99999 })).replace(/=+$/, "");
    await expect(verifyTicket(`${forged}.${signature}`, SECRET)).rejects.toMatchObject({ reason: "signature" });

    await expect(verifyTicket(ticket, SECRET, now + 121_000)).rejects.toMatchObject({ reason: "expired" });
  });

  it("rejects garbage and short secrets", async () => {
    await expect(verifyTicket("nope", SECRET)).rejects.toBeInstanceOf(TicketError);
    await expect(verifyTicket("a.b.c", SECRET)).rejects.toBeInstanceOf(TicketError);
    await expect(signTicket(input, "short")).rejects.toThrow(/32 characters/);
  });
});
