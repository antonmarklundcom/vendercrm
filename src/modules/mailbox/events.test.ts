import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "events-secret-for-tests-0123456789";
const env: Record<string, string | undefined> = {};

vi.mock("@/lib/config/env", () => ({ env }));
const recordDeliveryEvent = vi.fn();
vi.mock("./breaker", () => ({ recordDeliveryEvent: (...a: unknown[]) => recordDeliveryEvent(...a) }));

const { handleDeliveryEvents } = await import("./events");
const { signInbound } = await import("./signature");

function signed(body: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  return new Headers({ "x-vendercrm-timestamp": ts, "x-vendercrm-signature": signInbound(SECRET, ts, body) });
}

const body = JSON.stringify({
  version: 1,
  events: [
    { type: "bounced", sender: "ventas@t.com.py", recipient: "a@example.com" },
    { type: "complained", sender: "ventas@t.com.py", recipient: "b@example.com", subject: "Re: x" },
  ],
});

beforeEach(() => {
  recordDeliveryEvent.mockReset();
  Object.assign(env, {
    STORAGE_DRIVER: "s3",
    CLOUDFLARE_ACCOUNT_ID: "acc",
    CLOUDFLARE_EMAIL_API_TOKEN: "tok",
    EMAIL_INBOUND_SECRET: SECRET,
  });
});

describe("handleDeliveryEvents", () => {
  it("is 404 while the mailbox is off", async () => {
    env.EMAIL_INBOUND_SECRET = undefined;
    expect((await handleDeliveryEvents(body, signed(body))).status).toBe(404);
  });

  it("rejects an unsigned request and a malformed one", async () => {
    expect((await handleDeliveryEvents(body, new Headers())).status).toBe(401);
    const bad = JSON.stringify({ version: 1, events: [{ type: "delivered" }] });
    expect((await handleDeliveryEvents(bad, signed(bad))).status).toBe(400);
    expect(recordDeliveryEvent).not.toHaveBeenCalled();
  });

  it("records each event and reports how many matched a send", async () => {
    recordDeliveryEvent.mockResolvedValueOnce("matched").mockResolvedValueOnce("unmatched");
    expect(await handleDeliveryEvents(body, signed(body))).toEqual({
      status: 200,
      body: { processed: 2, matched: 1 },
    });
    expect(recordDeliveryEvent).toHaveBeenCalledTimes(2);
  });
});
