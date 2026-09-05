import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Web push (PLAN.md §15.5 J2, §15.8 P2). The three things that decide whether
// a push arrives, tested without a MySQL and without the network:
//
//  - with VAPID keys set, a `push.send` payload reaches the `web-push` call;
//  - with no keys, nothing is called and nothing throws;
//  - a 410 or 404 from the push service marks the subscription for deletion,
//    which is the only reason a dead endpoint ever leaves the table.
//
// `@/lib/config/env` is mocked rather than driven through `process.env`
// because it parses once at module load, and a suite that imports it for real
// needs the whole platform's environment just to ask about two keys.

const keys = {
  WEB_PUSH_PUBLIC_KEY: "test-public-key",
  WEB_PUSH_PRIVATE_KEY: "test-private-key",
  WEB_PUSH_SUBJECT: "mailto:test@example.com",
};

const envValues: Record<string, string | undefined> = { ...keys };

vi.mock("@/lib/config/env", () => ({
  get env() {
    return envValues;
  },
}));

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();

// The real WebPushError, so `statusOf` is exercised the way production hits it
// rather than against a hand-rolled stand-in with a statusCode property.
class FakeWebPushError extends Error {
  constructor(readonly statusCode: number) {
    super(`push service answered ${statusCode}`);
  }
}

vi.mock("web-push", () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
  },
  WebPushError: FakeWebPushError,
}));

const target = (id: string, endpoint = `https://push.example/${id}`) => ({
  id,
  endpoint,
  p256dh: `p256dh-${id}`,
  auth: `auth-${id}`,
});

const payload = { title: "Ana Gómez", body: "Hola, quería consultar", url: "/inbox/c1" };

beforeEach(() => {
  Object.assign(envValues, keys);
  sendNotification.mockReset();
  setVapidDetails.mockReset();
  sendNotification.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.resetModules();
});

describe("isPushConfigured", () => {
  it("needs all three values", async () => {
    const { isPushConfigured, pushPublicKey } = await import("./push");
    expect(isPushConfigured()).toBe(true);
    expect(pushPublicKey()).toBe("test-public-key");

    envValues.WEB_PUSH_PRIVATE_KEY = undefined;
    expect(isPushConfigured()).toBe(false);
    // The UI branches on this: no key, no control to press.
    expect(pushPublicKey()).toBeNull();
  });
});

describe("deliverToTargets", () => {
  it("reaches the web-push call with the payload and the VAPID details", async () => {
    const { deliverToTargets } = await import("./push");

    const outcomes = await deliverToTargets([target("s1")], payload);

    expect(outcomes).toEqual([{ id: "s1", result: "sent" }]);
    expect(setVapidDetails).toHaveBeenCalledWith(
      "mailto:test@example.com",
      "test-public-key",
      "test-private-key",
    );
    expect(sendNotification).toHaveBeenCalledTimes(1);

    const [subscription, body] = sendNotification.mock.calls[0];
    expect(subscription).toEqual({
      endpoint: "https://push.example/s1",
      keys: { p256dh: "p256dh-s1", auth: "auth-s1" },
    });
    expect(JSON.parse(body as string)).toEqual({
      title: "Ana Gómez",
      body: "Hola, quería consultar",
      url: "/inbox/c1",
    });
  });

  it("sends the service worker a landing page even when the caller gave none", async () => {
    const { deliverToTargets } = await import("./push");
    await deliverToTargets([target("s1")], { title: "Aviso" });

    expect(JSON.parse(sendNotification.mock.calls[0][1] as string)).toMatchObject({
      body: "",
      url: "/dashboard",
    });
  });

  it("does nothing at all without keys — no call, no throw", async () => {
    envValues.WEB_PUSH_PRIVATE_KEY = undefined;
    const { deliverToTargets } = await import("./push");

    await expect(deliverToTargets([target("s1")], payload)).resolves.toEqual([]);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(setVapidDetails).not.toHaveBeenCalled();
  });

  it("reports 410 and 404 as gone, so the caller deletes the row", async () => {
    const { deliverToTargets } = await import("./push");
    sendNotification
      .mockRejectedValueOnce(new FakeWebPushError(410))
      .mockRejectedValueOnce(new FakeWebPushError(404));

    const outcomes = await deliverToTargets([target("s1"), target("s2")], payload);

    expect(outcomes).toEqual([
      { id: "s1", result: "gone", status: 410 },
      { id: "s2", result: "gone", status: 404 },
    ]);
  });

  it("keeps a subscription that failed for any other reason", async () => {
    const { deliverToTargets } = await import("./push");
    // 429 and 500 are the push service having a bad day, not a dead endpoint:
    // deleting on those would silently unsubscribe a whole tenant.
    sendNotification
      .mockRejectedValueOnce(new FakeWebPushError(429))
      .mockRejectedValueOnce(new Error("socket hang up"));

    const outcomes = await deliverToTargets([target("s1"), target("s2")], payload);

    expect(outcomes).toEqual([
      { id: "s1", result: "failed", status: 429, error: "push service answered 429" },
      { id: "s2", result: "failed", status: null, error: "socket hang up" },
    ]);
  });

  it("one dead browser does not stop the person's other browsers", async () => {
    const { deliverToTargets } = await import("./push");
    sendNotification
      .mockRejectedValueOnce(new FakeWebPushError(410))
      .mockResolvedValueOnce(undefined);

    const outcomes = await deliverToTargets([target("phone"), target("laptop")], payload);

    expect(outcomes.map((o) => o.result)).toEqual(["gone", "sent"]);
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it("skips the push service entirely when there is nobody to send to", async () => {
    const { deliverToTargets } = await import("./push");
    await expect(deliverToTargets([], payload)).resolves.toEqual([]);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
