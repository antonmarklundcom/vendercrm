import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/env", () => ({ env: {} }));
vi.mock("@/lib/storage", () => ({ storage: {} }));
vi.mock("@/db/client", () => ({ db: {} }));

const { dailyCapFor, MAILBOX_DAILY_CAP, WARMUP_DAILY_CAP } = await import("./guard");
const { breakerVerdict } = await import("./breaker");
const { toDeliveryEvent } = await import("../../../workers/email-inbound/src/payload");

const now = new Date("2026-09-25T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("dailyCapFor", () => {
  it("warms up for the first 14 days, then uses the platform cap", () => {
    expect(dailyCapFor({ firstMailboxAt: daysAgo(3), planCap: null, now })).toEqual({
      cap: WARMUP_DAILY_CAP,
      warmingUp: true,
    });
    expect(dailyCapFor({ firstMailboxAt: daysAgo(15), planCap: null, now })).toEqual({
      cap: MAILBOX_DAILY_CAP,
      warmingUp: false,
    });
  });

  it("never goes above the plan's own maxEmailsPerDay", () => {
    expect(dailyCapFor({ firstMailboxAt: daysAgo(30), planCap: 50, now }).cap).toBe(50);
    expect(dailyCapFor({ firstMailboxAt: daysAgo(1), planCap: 5, now }).cap).toBe(5);
  });
});

describe("breakerVerdict", () => {
  it("trips above 3 % bounces of the last 50 sends (2 or more)", () => {
    expect(breakerVerdict({ bounced: 1, complained: 0 })).toBeNull();
    expect(breakerVerdict({ bounced: 2, complained: 0 })).toBe("bounce_rate");
  });

  it("trips on a second complaint", () => {
    expect(breakerVerdict({ bounced: 0, complained: 1 })).toBeNull();
    expect(breakerVerdict({ bounced: 0, complained: 2 })).toBe("complaints");
  });
});

describe("toDeliveryEvent (Worker)", () => {
  const base = {
    payload: { sender: "Ventas@Tienda.com.py", recipient: "ana@example.com", subject: "Re: Hola" },
    metadata: { eventTimestamp: "2026-06-01T02:48:57.132Z" },
  };

  it("maps bounced and complained events", () => {
    expect(toDeliveryEvent({ ...base, type: "cf.email.sending.message.bounced" })).toEqual({
      type: "bounced",
      sender: "ventas@tienda.com.py",
      recipient: "ana@example.com",
      subject: "Re: Hola",
      at: "2026-06-01T02:48:57.132Z",
    });
    expect(toDeliveryEvent({ ...base, type: "cf.email.sending.message.complained" })?.type).toBe(
      "complained",
    );
  });

  it("ignores every other event and malformed ones", () => {
    for (const type of ["delivered", "deferred", "failed", "rejected"]) {
      expect(toDeliveryEvent({ ...base, type: `cf.email.sending.message.${type}` })).toBeNull();
    }
    expect(toDeliveryEvent({ type: "cf.email.sending.message.bounced", payload: {} })).toBeNull();
  });
});
