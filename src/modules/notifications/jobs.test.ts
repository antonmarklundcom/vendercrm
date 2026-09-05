import { beforeEach, describe, expect, it, vi } from "vitest";

// The `push.send` handler's decisions (PLAN.md §15.5 J2, §15.8 P2), with the
// rows mocked and the transport real: this is the path from "a job came off
// the queue" to "web-push was called", which is the phase's exit criterion.
// The same path against real rows is push.integration.test.ts (CI only).

const envValues: Record<string, string | undefined> = {
  WEB_PUSH_PUBLIC_KEY: "public",
  WEB_PUSH_PRIVATE_KEY: "private",
  WEB_PUSH_SUBJECT: "mailto:test@example.com",
};

vi.mock("@/lib/config/env", () => ({
  get env() {
    return envValues;
  },
}));

const sendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    setVapidDetails: () => {},
  },
  WebPushError: class extends Error {
    constructor(readonly statusCode: number) {
      super(String(statusCode));
    }
  },
}));

// Registering handlers and event listeners is the worker's business, not this
// suite's — both are import-time side effects of ./jobs.
vi.mock("@/worker/handlers", () => ({ registerHandler: () => {} }));
vi.mock("./hooks", () => ({ registerNotificationHooks: () => {} }));

const ctx = {
  tenantId: "tenant-1",
  userId: "system",
  role: "admin" as const,
  impersonatorUserId: null,
  accessStatus: "active" as const,
};

const buildSystemTenantContext = vi.fn();
vi.mock("@/modules/tenancy/context", () => ({
  buildSystemTenantContext: (...args: unknown[]) => buildSystemTenantContext(...args),
}));

const getActiveTenantUser = vi.fn();
vi.mock("@/modules/tenancy/users", () => ({
  getActiveTenantUser: (...args: unknown[]) => getActiveTenantUser(...args),
}));

const listSubscriptionsForUser = vi.fn();
const applyOutcomes = vi.fn();
vi.mock("./subscriptions", () => ({
  listSubscriptionsForUser: (...args: unknown[]) => listSubscriptionsForUser(...args),
  applyOutcomes: (...args: unknown[]) => applyOutcomes(...args),
  toTargets: (rows: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>) =>
    rows.map((row) => ({
      id: row.id,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
    })),
}));

const row = {
  id: "sub-1",
  endpoint: "https://push.example/sub-1",
  p256dh: "p256dh",
  auth: "auth",
};

const job = {
  userId: "user-1",
  kind: "assignment" as const,
  payload: { title: "Te asignaron", body: "Ana Gómez", url: "/inbox/c1" },
};

beforeEach(() => {
  Object.assign(envValues, {
    WEB_PUSH_PUBLIC_KEY: "public",
    WEB_PUSH_PRIVATE_KEY: "private",
    WEB_PUSH_SUBJECT: "mailto:test@example.com",
  });
  sendNotification.mockReset().mockResolvedValue(undefined);
  buildSystemTenantContext.mockReset().mockResolvedValue(ctx);
  getActiveTenantUser
    .mockReset()
    .mockResolvedValue({ id: "user-1", banned: false, pushPrefs: null });
  listSubscriptionsForUser.mockReset().mockResolvedValue([row]);
  applyOutcomes.mockReset().mockResolvedValue(undefined);
});

describe("sendPush", () => {
  it("delivers a queued push to the user's browser", async () => {
    const { sendPush } = await import("./jobs");
    await sendPush("tenant-1", job);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [subscription, body] = sendNotification.mock.calls[0];
    expect(subscription).toEqual({
      endpoint: "https://push.example/sub-1",
      keys: { p256dh: "p256dh", auth: "auth" },
    });
    expect(JSON.parse(body as string)).toMatchObject({
      title: "Te asignaron",
      url: "/inbox/c1",
    });
    expect(applyOutcomes).toHaveBeenCalledWith(ctx, [{ id: "sub-1", result: "sent" }]);
  });

  it("does nothing, and does not throw, when the platform has no keys", async () => {
    envValues.WEB_PUSH_PRIVATE_KEY = undefined;
    const { sendPush } = await import("./jobs");

    await expect(sendPush("tenant-1", job)).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
    // Not even a row read: an unconfigured platform costs the queue nothing.
    expect(listSubscriptionsForUser).not.toHaveBeenCalled();
  });

  it("stays quiet for a kind this user muted", async () => {
    getActiveTenantUser.mockResolvedValue({
      id: "user-1",
      banned: false,
      pushPrefs: { assignment: false },
    });
    const { sendPush } = await import("./jobs");

    await sendPush("tenant-1", job);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("still buzzes for a kind the user left alone", async () => {
    getActiveTenantUser.mockResolvedValue({
      id: "user-1",
      banned: false,
      pushPrefs: { inbound_message: false },
    });
    const { sendPush } = await import("./jobs");

    await sendPush("tenant-1", job);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("drops the push for somebody who can no longer act in this business", async () => {
    const { sendPush } = await import("./jobs");

    // Deleted, banned platform-wide, or no longer a member here — all one
    // answer from getActiveTenantUser, which is the point of using it.
    getActiveTenantUser.mockResolvedValue(null);
    await sendPush("tenant-1", job);
    expect(getActiveTenantUser).toHaveBeenCalledWith("user-1", "tenant-1");

    // Still a member, but deactivated in this business.
    getActiveTenantUser.mockResolvedValue({ id: "user-1", banned: true, pushPrefs: null });
    await sendPush("tenant-1", job);

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("finishes quietly when the user has no browser registered", async () => {
    listSubscriptionsForUser.mockResolvedValue([]);
    const { sendPush } = await import("./jobs");

    await expect(sendPush("tenant-1", job)).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
    // No outcomes to apply, so no pointless write.
    expect(applyOutcomes).not.toHaveBeenCalled();
  });

  it("gives up on a tenant that no longer resolves", async () => {
    buildSystemTenantContext.mockResolvedValue(null);
    const { sendPush } = await import("./jobs");

    await expect(sendPush("tenant-1", job)).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
