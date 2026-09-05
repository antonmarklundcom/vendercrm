import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// What the push rows promise, against rows that really exist (PLAN.md §15.5
// J2, §15.8 P2). Three things only a database can show:
//
//  - the subscription lifecycle: one row per browser, re-subscribing moves it
//    rather than duplicating it, and unsubscribing is scoped to its owner;
//  - `push.send` end to end — a fake subscription reaches the `web-push` call
//    and a muted kind does not;
//  - 410 cleanup: a dead endpoint leaves the table, a failed one does not.
//
// Same harness as the other integration suites: skipped without a MySQL, so
// this runs in CI (no database in the build container).
const hasDb = !!process.env.DATABASE_URL;

const sendNotification = vi.fn();

class FakeWebPushError extends Error {
  constructor(readonly statusCode: number) {
    super(`push service answered ${statusCode}`);
  }
}

vi.mock("web-push", () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    setVapidDetails: () => {},
  },
  WebPushError: FakeWebPushError,
}));

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("web push (MySQL integration)", () => {
  let newId: (typeof import("@/lib/ids"))["newId"];
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let subs: typeof import("./subscriptions");

  type TenantContext = import("@/modules/tenancy/context").TenantContext;

  let ctx: TenantContext;
  let otherCtx: TenantContext;
  let userId: string;
  let colleagueId: string;

  const endpointFor = (name: string) => `https://push.example.test/${name}`;

  const subscription = (endpoint: string) => ({
    endpoint,
    p256dh: "BFakeP256dhKeyForTests",
    auth: "fake-auth-secret",
  });

  async function rowsFor(context: TenantContext, forUserId: string) {
    return subs.listSubscriptionsForUser(context, forUserId);
  }

  beforeAll(async () => {
    // The VAPID keys have to be in place before `@/lib/config/env` is parsed,
    // which happens the first time anything imports the db client.
    process.env.WEB_PUSH_PUBLIC_KEY = "integration-public-key";
    process.env.WEB_PUSH_PRIVATE_KEY = "integration-private-key";
    process.env.WEB_PUSH_SUBJECT = "mailto:test@example.com";

    ({ newId } = await import("@/lib/ids"));
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    subs = await import("./subscriptions");
    const { createTenant } = await import("@/modules/tenancy/tenants");

    const superadmin = { userId: "sa-push", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, {
      name: `Push ${newId()}`,
      slug: `push-${newId()}`,
    });
    const other = await createTenant(superadmin, {
      name: `Push otro ${newId()}`,
      slug: `push-otro-${newId()}`,
    });

    ctx = {
      tenantId: tenant!.id,
      userId: "system",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };
    otherCtx = { ...ctx, tenantId: other!.id };

    userId = newId();
    colleagueId = newId();
    await db.insert(schema.users).values([
      {
        id: userId,
        tenantId: ctx.tenantId,
        email: `push-${userId}@example.com`,
        name: "Rep con celular",
        role: "agent",
      },
      {
        id: colleagueId,
        tenantId: ctx.tenantId,
        email: `push-${colleagueId}@example.com`,
        name: "Colega",
        role: "agent",
      },
    ]);
    await db.insert(schema.tenantMemberships).values([
      { id: newId(), tenantId: ctx.tenantId, userId, role: "agent" },
      { id: newId(), tenantId: ctx.tenantId, userId: colleagueId, role: "agent" },
    ]);
  });

  describe("subscription lifecycle", () => {
    it("records a browser and finds it again", async () => {
      const endpoint = endpointFor(`first-${newId()}`);
      await subs.saveSubscription(ctx, userId, {
        ...subscription(endpoint),
        userAgent: "Mozilla/5.0 (Android)",
      });

      const rows = await rowsFor(ctx, userId);
      const row = rows.find((r) => r.endpoint === endpoint);
      expect(row).toBeDefined();
      expect(row!.userId).toBe(userId);
      expect(row!.tenantId).toBe(ctx.tenantId);
      expect(row!.userAgent).toBe("Mozilla/5.0 (Android)");
      expect(row!.lastSeenAt).not.toBeNull();
    });

    it("re-subscribing the same browser updates rather than duplicates", async () => {
      const endpoint = endpointFor(`repeat-${newId()}`);
      await subs.saveSubscription(ctx, userId, subscription(endpoint));
      await subs.saveSubscription(ctx, userId, {
        ...subscription(endpoint),
        auth: "rotated-auth",
      });

      const rows = (await rowsFor(ctx, userId)).filter((r) => r.endpoint === endpoint);
      // One browser, one row — two would deliver every notification twice.
      expect(rows).toHaveLength(1);
      expect(rows[0].auth).toBe("rotated-auth");
    });

    it("moves the row when somebody else signs in on the same browser", async () => {
      const endpoint = endpointFor(`shared-${newId()}`);
      await subs.saveSubscription(ctx, userId, subscription(endpoint));
      // A shared phone, or the same person switching business (§3.1): the
      // previous owner must stop receiving on a device that is no longer
      // theirs, which is why the endpoint is unique platform-wide.
      await subs.saveSubscription(otherCtx, colleagueId, subscription(endpoint));

      expect((await rowsFor(ctx, userId)).map((r) => r.endpoint)).not.toContain(endpoint);
      const moved = await rowsFor(otherCtx, colleagueId);
      expect(moved.map((r) => r.endpoint)).toContain(endpoint);
      expect(moved.find((r) => r.endpoint === endpoint)!.tenantId).toBe(otherCtx.tenantId);
    });

    it("unsubscribes only the caller's own browser", async () => {
      const mine = endpointFor(`mine-${newId()}`);
      const theirs = endpointFor(`theirs-${newId()}`);
      await subs.saveSubscription(ctx, userId, subscription(mine));
      await subs.saveSubscription(ctx, colleagueId, subscription(theirs));

      // Naming somebody else's endpoint does nothing at all.
      await subs.deleteSubscriptionForUser(ctx, userId, theirs);
      expect((await rowsFor(ctx, colleagueId)).map((r) => r.endpoint)).toContain(theirs);

      await subs.deleteSubscriptionForUser(ctx, userId, mine);
      expect((await rowsFor(ctx, userId)).map((r) => r.endpoint)).not.toContain(mine);
    });

    it("does not hand one tenant another tenant's subscriptions", async () => {
      const endpoint = endpointFor(`isolated-${newId()}`);
      await subs.saveSubscription(ctx, userId, subscription(endpoint));

      // Same user id, wrong tenant context: nothing comes back.
      expect(await rowsFor(otherCtx, userId)).toEqual([]);
    });
  });

  describe("push.send", () => {
    it("reaches the web-push call for a subscribed user", async () => {
      const { sendPush } = await import("./jobs");
      const endpoint = endpointFor(`send-${newId()}`);
      await subs.saveSubscription(ctx, userId, subscription(endpoint));
      sendNotification.mockReset();
      sendNotification.mockResolvedValue(undefined);

      await sendPush(ctx.tenantId, {
        userId,
        kind: "assignment",
        payload: { title: "Te asignaron", body: "Ana Gómez", url: "/inbox/c1" },
      });

      const call = sendNotification.mock.calls.find(
        ([subscriptionArg]) => (subscriptionArg as { endpoint: string }).endpoint === endpoint,
      );
      expect(call).toBeDefined();
      expect(JSON.parse(call![1] as string)).toMatchObject({
        title: "Te asignaron",
        url: "/inbox/c1",
      });
    });

    it("stays quiet for a kind the user muted", async () => {
      const { sendPush } = await import("./jobs");
      const { eq } = await import("drizzle-orm");
      const endpoint = endpointFor(`muted-${newId()}`);
      await subs.saveSubscription(ctx, userId, subscription(endpoint));
      await db
        .update(schema.users)
        .set({ pushPrefs: { inbound_message: false } })
        .where(eq(schema.users.id, userId));
      sendNotification.mockReset();
      sendNotification.mockResolvedValue(undefined);

      await sendPush(ctx.tenantId, {
        userId,
        kind: "inbound_message",
        payload: { title: "Cliente nuevo" },
      });
      expect(sendNotification).not.toHaveBeenCalled();

      // The mute is per kind, not a master switch — the row is still there
      // and everything else still arrives.
      await sendPush(ctx.tenantId, {
        userId,
        kind: "assignment",
        payload: { title: "Te asignaron" },
      });
      expect(sendNotification).toHaveBeenCalled();

      await db.update(schema.users).set({ pushPrefs: null }).where(eq(schema.users.id, userId));
    });
  });

  describe("410 cleanup", () => {
    it("deletes the endpoint the push service says is gone, and keeps the rest", async () => {
      const { sendPush } = await import("./jobs");
      const dead = endpointFor(`dead-${newId()}`);
      const alive = endpointFor(`alive-${newId()}`);
      const flaky = endpointFor(`flaky-${newId()}`);
      for (const endpoint of [dead, alive, flaky]) {
        await subs.saveSubscription(ctx, userId, subscription(endpoint));
      }

      sendNotification.mockReset();
      sendNotification.mockImplementation(async (target: { endpoint: string }) => {
        if (target.endpoint === dead) throw new FakeWebPushError(410);
        // 500 is the service having a bad day, not a dead browser: deleting
        // on it would silently unsubscribe people during an outage.
        if (target.endpoint === flaky) throw new FakeWebPushError(500);
      });

      await sendPush(ctx.tenantId, {
        userId,
        kind: "assignment",
        payload: { title: "Aviso" },
      });

      const after = await rowsFor(ctx, userId);
      const endpoints = after.map((r) => r.endpoint);
      expect(endpoints).not.toContain(dead);
      expect(endpoints).toContain(alive);
      expect(endpoints).toContain(flaky);
      expect(after.find((r) => r.endpoint === flaky)!.failedAt).not.toBeNull();
      // A successful send clears an earlier failure rather than leaving the
      // row looking broken forever.
      expect(after.find((r) => r.endpoint === alive)!.failedAt).toBeNull();

      sendNotification.mockReset();
    });
  });
});
