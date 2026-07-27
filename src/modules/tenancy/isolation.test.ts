import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Cross-tenant isolation test suite (PLAN.md §3.3 layer 3, §10 1B exit
// criteria: "isolation suite green"). Runs only against a real MySQL (CI
// provides one as a service container, same pattern as
// src/worker/index.integration.test.ts) — skipped locally without
// DATABASE_URL so `npm test` doesn't require a live database.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("tenancy isolation", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let newId: (typeof import("@/lib/ids"))["newId"];
  let tenantDb: (typeof import("./db"))["tenantDb"];
  let createTenant: (typeof import("./tenants"))["createTenant"];
  let createPlan: (typeof import("./plans"))["createPlan"];
  let createSubscription: (typeof import("./subscriptions"))["createSubscription"];
  let recordPayment: (typeof import("./subscriptions"))["recordPayment"];
  let getLatestSubscriptionForTenant: (typeof import("./subscriptions"))["getLatestSubscriptionForTenant"];
  let computeAccessStatus: (typeof import("./subscriptions"))["computeAccessStatus"];
  let listUsersForTenant: (typeof import("./users"))["listUsersForTenant"];

  type TenantContext = import("./context").TenantContext;
  type SuperadminContext = import("./context").SuperadminContext;

  const superadmin: SuperadminContext = { userId: "sa-test", impersonatorUserId: null };

  let tenantAId: string;
  let tenantBId: string;
  let ctxA: TenantContext;
  let ctxB: TenantContext;

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    ({ newId } = await import("@/lib/ids"));
    ({ tenantDb } = await import("./db"));
    ({ createTenant } = await import("./tenants"));
    ({ createPlan } = await import("./plans"));
    ({
      createSubscription,
      recordPayment,
      getLatestSubscriptionForTenant,
      computeAccessStatus,
    } = await import("./subscriptions"));
    ({ listUsersForTenant } = await import("./users"));

    const tenantA = await createTenant(superadmin, {
      name: "Tenant A",
      slug: `tenant-a-${newId()}`,
    });
    const tenantB = await createTenant(superadmin, {
      name: "Tenant B",
      slug: `tenant-b-${newId()}`,
    });
    tenantAId = tenantA!.id;
    tenantBId = tenantB!.id;

    const userAId = newId();
    const userBId = newId();
    await db.insert(schema.users).values([
      {
        id: userAId,
        tenantId: tenantAId,
        email: `user-a-${userAId}@example.com`,
        name: "User A",
        role: "admin",
      },
      {
        id: userBId,
        tenantId: tenantBId,
        email: `user-b-${userBId}@example.com`,
        name: "User B",
        role: "admin",
      },
    ]);

    ctxA = {
      tenantId: tenantAId,
      userId: userAId,
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
      siteScope: null,
    };
    ctxB = {
      tenantId: tenantBId,
      userId: userBId,
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
      siteScope: null,
    };
  });

  afterAll(async () => {
    if (!db) return;
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  it("tenantDb.insert always stamps the caller's own tenant_id, never a client-supplied one", async () => {
    const id = newId();
    // Even if a caller tried to smuggle a different tenantId through the
    // values object, the wrapper's `Omit<..., "tenantId">` type plus the
    // trailing spread in db.ts (`{ ...values, tenantId: ctx.tenantId }`)
    // makes ctx the only source of truth. The cast below simulates a caller
    // bypassing the type system (e.g. via `any`); the runtime behavior is
    // what's under test, not the compile-time guard.
    const spoofedValues = {
      id,
      email: "spoofed@example.com",
      role: "agent",
      token: newId(),
      invitedBy: ctxA.userId,
      expiresAt: new Date(Date.now() + 86400000),
      tenantId: tenantBId,
    };
    await tenantDb(ctxA)
      .insert(schema.invitations)
      .values(spoofedValues as unknown as Omit<typeof schema.invitations.$inferInsert, "tenantId">);

    const [row] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, id));
    expect(row.tenantId).toBe(tenantAId);
    expect(row.tenantId).not.toBe(tenantBId);
  });

  it("tenantDb.select never returns another tenant's rows", async () => {
    const idA = newId();
    const idB = newId();

    await tenantDb(ctxA).insert(schema.invitations).values({
      id: idA,
      email: "a@example.com",
      role: "agent",
      token: newId(),
      invitedBy: ctxA.userId,
      expiresAt: new Date(Date.now() + 86400000),
    });
    await tenantDb(ctxB).insert(schema.invitations).values({
      id: idB,
      email: "b@example.com",
      role: "agent",
      token: newId(),
      invitedBy: ctxB.userId,
      expiresAt: new Date(Date.now() + 86400000),
    });

    const rowsForA = await tenantDb(ctxA).select(schema.invitations);
    const rowsForB = await tenantDb(ctxB).select(schema.invitations);

    expect(rowsForA.some((r) => r.id === idA)).toBe(true);
    expect(rowsForA.some((r) => r.id === idB)).toBe(false);
    expect(rowsForB.some((r) => r.id === idB)).toBe(true);
    expect(rowsForB.some((r) => r.id === idA)).toBe(false);
  });

  it("tenantDb.select scoped to another tenant's row id returns nothing (no cross-tenant read by guessing an id)", async () => {
    const idB = newId();
    await tenantDb(ctxB).insert(schema.invitations).values({
      id: idB,
      email: "b2@example.com",
      role: "agent",
      token: newId(),
      invitedBy: ctxB.userId,
      expiresAt: new Date(Date.now() + 86400000),
    });

    const rows = await tenantDb(ctxA).select(schema.invitations, eq(schema.invitations.id, idB));
    expect(rows).toHaveLength(0);
  });

  it("tenantDb.update cannot mutate another tenant's row even when targeted by id", async () => {
    const idB = newId();
    await tenantDb(ctxB).insert(schema.invitations).values({
      id: idB,
      email: "b3@example.com",
      role: "agent",
      token: newId(),
      invitedBy: ctxB.userId,
      expiresAt: new Date(Date.now() + 86400000),
    });

    await tenantDb(ctxA)
      .update(schema.invitations)
      .set({ role: "admin" })
      .where(eq(schema.invitations.id, idB));

    const [row] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, idB));
    expect(row.role).toBe("agent"); // unchanged
  });

  it("tenantDb.delete cannot remove another tenant's row even when targeted by id", async () => {
    const idB = newId();
    await tenantDb(ctxB).insert(schema.invitations).values({
      id: idB,
      email: "b4@example.com",
      role: "agent",
      token: newId(),
      invitedBy: ctxB.userId,
      expiresAt: new Date(Date.now() + 86400000),
    });

    await tenantDb(ctxA).delete(schema.invitations, eq(schema.invitations.id, idB));

    const [row] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, idB));
    expect(row).toBeDefined();
    expect(row.id).toBe(idB);
  });

  it("users are isolated per tenant via tenantDb, and superadmin's cross-tenant lookup is scoped by tenantId argument", async () => {
    const usersForA = await tenantDb(ctxA).select(schema.users);
    expect(usersForA.every((u) => u.tenantId === tenantAId)).toBe(true);

    const usersForTenantB = await listUsersForTenant(tenantBId);
    expect(usersForTenantB.every((u) => u.tenantId === tenantBId)).toBe(true);
    expect(usersForTenantB.some((u) => u.tenantId === tenantAId)).toBe(false);
  });

  it("recording a payment against tenant A's subscription never affects tenant B's", async () => {
    const plan = await createPlan(superadmin, {
      name: `Plan ${newId()}`,
      durationMonths: 3,
      price: 100000,
    });

    const subA = await createSubscription(superadmin, { tenantId: tenantAId, planId: plan!.id });
    const subB = await createSubscription(superadmin, { tenantId: tenantBId, planId: plan!.id });

    const expiresBeforeA = subA!.expiresAt.getTime();
    const expiresBeforeB = subB!.expiresAt.getTime();

    await recordPayment(superadmin, {
      subscriptionId: subA!.id,
      amount: 100000,
      method: "transfer",
    });

    const refreshedA = await getLatestSubscriptionForTenant(tenantAId);
    const refreshedB = await getLatestSubscriptionForTenant(tenantBId);

    expect(refreshedA!.expiresAt.getTime()).toBeGreaterThan(expiresBeforeA);
    expect(refreshedB!.expiresAt.getTime()).toBe(expiresBeforeB); // untouched
  });

  it("computeAccessStatus: active, grace, and locked transitions, independent per tenant", async () => {
    const plan = await createPlan(superadmin, {
      name: `Plan ${newId()}`,
      durationMonths: 3,
      price: 50000,
    });

    // Fresh tenants for this scenario — tenantA/tenantB already picked up
    // subscriptions from earlier tests in this suite, and
    // getLatestSubscriptionForTenant is by-design "most recent by
    // starts_at", so reusing them here would silently pick up the wrong row.
    const tenantD = await createTenant(superadmin, { name: "Tenant D", slug: `tenant-d-${newId()}` });
    const tenantE = await createTenant(superadmin, { name: "Tenant E", slug: `tenant-e-${newId()}` });

    // Tenant D: subscription in the future -> active.
    await db.insert(schema.subscriptions).values({
      id: newId(),
      tenantId: tenantD!.id,
      planId: plan!.id,
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86400000),
      status: "active",
    });
    expect(await computeAccessStatus(tenantD!.id, "active")).toBe("active");

    // Tenant E: subscription expired 2 days ago -> grace (within 7-day window).
    await db.insert(schema.subscriptions).values({
      id: newId(),
      tenantId: tenantE!.id,
      planId: plan!.id,
      startsAt: new Date(Date.now() - 90 * 86400000),
      expiresAt: new Date(Date.now() - 2 * 86400000),
      status: "active",
    });
    expect(await computeAccessStatus(tenantE!.id, "active")).toBe("grace");

    // A third tenant, expired 30 days ago -> locked (past grace window).
    const tenantC = await createTenant(superadmin, {
      name: "Tenant C",
      slug: `tenant-c-${newId()}`,
    });
    await db.insert(schema.subscriptions).values({
      id: newId(),
      tenantId: tenantC!.id,
      planId: plan!.id,
      startsAt: new Date(Date.now() - 120 * 86400000),
      expiresAt: new Date(Date.now() - 30 * 86400000),
      status: "expired",
    });
    expect(await computeAccessStatus(tenantC!.id, "active")).toBe("locked");

    // A suspended tenant is always locked, regardless of subscription state.
    expect(await computeAccessStatus(tenantAId, "suspended")).toBe("locked");
  });

  it("tenantDb rejects writes for a grace or locked context but still allows reads (PLAN.md §10 1C follow-up #1)", async () => {
    const graceCtx: TenantContext = { ...ctxA, accessStatus: "grace" };
    const lockedCtx: TenantContext = { ...ctxA, accessStatus: "locked" };

    const attemptInsert = (ctx: TenantContext) =>
      tenantDb(ctx)
        .insert(schema.invitations)
        .values({
          id: newId(),
          email: `blocked-${newId()}@example.com`,
          role: "agent",
          token: newId(),
          invitedBy: ctx.userId,
          expiresAt: new Date(Date.now() + 86400000),
        });

    // assertTenantWritable throws synchronously (it runs before the
    // drizzle query builder ever produces a promise), so these are sync
    // throws, not rejected promises — toThrow, not rejects.toThrow.
    expect(() => attemptInsert(graceCtx)).toThrow(/not writable/);
    expect(() => attemptInsert(lockedCtx)).toThrow(/not writable/);

    const existingId = newId();
    await tenantDb(ctxA).insert(schema.invitations).values({
      id: existingId,
      email: `existing-${existingId}@example.com`,
      role: "agent",
      token: newId(),
      invitedBy: ctxA.userId,
      expiresAt: new Date(Date.now() + 86400000),
    });

    expect(() =>
      tenantDb(graceCtx)
        .update(schema.invitations)
        .set({ role: "admin" })
        .where(eq(schema.invitations.id, existingId)),
    ).toThrow(/not writable/);
    expect(() =>
      tenantDb(lockedCtx).delete(schema.invitations, eq(schema.invitations.id, existingId)),
    ).toThrow(/not writable/);

    // Reads still work — only mutation methods are gated.
    const rows = await tenantDb(graceCtx).select(
      schema.invitations,
      eq(schema.invitations.id, existingId),
    );
    expect(rows).toHaveLength(1);
  });
});
