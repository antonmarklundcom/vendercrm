import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The cross-tenant isolation suite (PLAN.md §3.3, layer 3). It creates two
// tenants and asserts no service or scoped query can read or mutate across the
// boundary. This suite is the merge gate for every later sub-phase that adds
// tenant-owned tables.
//
// DB-gated like the worker suite: runs only when DATABASE_URL is set (CI
// provides a MySQL service container and runs migrations first).
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("cross-tenant isolation", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let svc: typeof import("./service");
  let billing: typeof import("@/modules/billing/service");
  let access: typeof import("./access");
  let tenantDb: (typeof import("./db"))["tenantDb"];
  let newId: (typeof import("@/lib/ids"))["newId"];
  type TenantContext = import("./types").TenantContext;

  // Two isolated tenants set up once for the whole suite.
  let A: { tenantId: string; adminUserId: string; ctx: TenantContext };
  let B: { tenantId: string; adminUserId: string; ctx: TenantContext };

  const uniq = () => Math.random().toString(36).slice(2, 8);

  function ctxFor(tenantId: string, userId: string): TenantContext {
    return {
      tenantId,
      userId,
      role: "admin",
      isSuperadmin: false,
      impersonatorUserId: null,
    };
  }

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    svc = await import("./service");
    billing = await import("@/modules/billing/service");
    access = await import("./access");
    ({ tenantDb } = await import("./db"));
    ({ newId } = await import("@/lib/ids"));

    const s = uniq();
    const a = await svc.createTenant({
      name: "Tenant A",
      slug: `a-${s}`,
      adminEmail: `admin-a-${s}@x.com`,
      adminPassword: "password123",
      adminName: "Admin A",
    });
    const b = await svc.createTenant({
      name: "Tenant B",
      slug: `b-${s}`,
      adminEmail: `admin-b-${s}@x.com`,
      adminPassword: "password123",
      adminName: "Admin B",
    });
    A = { ...a, ctx: ctxFor(a.tenantId, a.adminUserId) };
    B = { ...b, ctx: ctxFor(b.tenantId, b.adminUserId) };
  });

  afterAll(async () => {
    if (!db) return;
    // Deliberately NOT closing the pool here: db/client.ts is a
    // module-level singleton, and depending on vitest's isolation/pool
    // settings it can be shared across test files run in the same
    // process — closing it here raced with other files still using it
    // (their queries would see a closed pool). The process exits when
    // the whole suite finishes, which reclaims the connection anyway.
  });

  it("tenantDb.select returns only the caller's tenant rows", async () => {
    await svc.createInvitation(A.ctx, { email: `x-${uniq()}@a.com`, role: "agent" });
    await svc.createInvitation(B.ctx, { email: `x-${uniq()}@b.com`, role: "agent" });

    const seenByA = await tenantDb(A.ctx).select(schema.invitations);
    const seenByB = await tenantDb(B.ctx).select(schema.invitations);

    expect(seenByA.length).toBeGreaterThan(0);
    expect(seenByA.every((r) => r.tenantId === A.tenantId)).toBe(true);
    expect(seenByB.every((r) => r.tenantId === B.tenantId)).toBe(true);
  });

  it("insert forces the caller's tenantId, ignoring a spoofed one", async () => {
    const id = newId();
    await tenantDb(A.ctx).insert(schema.invitations, {
      id,
      email: `spoof-${uniq()}@a.com`,
      token: newId(),
      expiresAt: new Date(Date.now() + 86_400_000),
      // Attempt to plant the row under tenant B:
      tenantId: B.tenantId,
    } as never);

    const [row] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, id));
    expect(row.tenantId).toBe(A.tenantId);
  });

  it("cannot update another tenant's row", async () => {
    const { id } = await svc.createInvitation(B.ctx, {
      email: `victim-${uniq()}@b.com`,
      role: "agent",
    });
    await tenantDb(A.ctx).update(
      schema.invitations,
      { email: "hacked@a.com" },
      eq(schema.invitations.id, id),
    );
    const [row] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, id));
    expect(row.email).not.toBe("hacked@a.com");
  });

  it("cannot delete another tenant's row", async () => {
    const { id } = await svc.createInvitation(B.ctx, {
      email: `victim2-${uniq()}@b.com`,
      role: "agent",
    });
    await tenantDb(A.ctx).delete(schema.invitations, eq(schema.invitations.id, id));
    const [row] = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, id));
    expect(row).toBeDefined();
  });

  it("revokeInvitation cannot revoke across tenants", async () => {
    const { id } = await svc.createInvitation(B.ctx, {
      email: `keep-${uniq()}@b.com`,
      role: "agent",
    });
    await svc.revokeInvitation(A.ctx, id); // A tries to revoke B's invite
    const stillThere = (await svc.listInvitations(B.ctx)).some((r) => r.id === id);
    expect(stillThere).toBe(true);
  });

  it("listTenantUsers is scoped to the caller's tenant", async () => {
    const usersA = await svc.listTenantUsers(A.ctx);
    const usersB = await svc.listTenantUsers(B.ctx);
    expect(usersA.some((u) => u.id === A.adminUserId)).toBe(true);
    expect(usersA.some((u) => u.id === B.adminUserId)).toBe(false);
    expect(usersB.some((u) => u.id === A.adminUserId)).toBe(false);
  });

  it("accepting an invite binds the new user to the inviting tenant only", async () => {
    const { token } = await svc.createInvitation(A.ctx, {
      email: `join-${uniq()}@a.com`,
      role: "agent",
    });
    const { userId, tenantId } = await svc.acceptInvitation({
      token,
      name: "Joiner",
      password: "password123",
    });
    expect(tenantId).toBe(A.tenantId);
    const [row] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    expect(row.tenantId).toBe(A.tenantId);
    expect(row.tenantId).not.toBe(B.tenantId);
  });

  it("an expired subscription locks the tenant out; active does not", async () => {
    // Give A a plan + payment → active.
    const planId = await billing.createPlan({
      name: `P-${uniq()}`,
      durationMonths: 3,
      price: 100000,
    });
    await billing.recordPayment({
      tenantId: A.tenantId,
      planId,
      amount: 100000,
      method: "transfer",
      recordedByUserId: A.adminUserId,
    });
    const activeAccess = await access.getTenantAccess(A.tenantId);
    expect(activeAccess.state).toBe("active");
    expect(activeAccess.writable).toBe(true);

    // Force A's subscription into the past → expired/locked.
    const sub = await billing.getSubscription(A.tenantId);
    await db
      .update(schema.subscriptions)
      .set({ expiresAt: new Date(Date.now() - 30 * 86_400_000) })
      .where(eq(schema.subscriptions.id, sub!.id));
    const expiredAccess = await access.getTenantAccess(A.tenantId);
    expect(expiredAccess.state).toBe("expired");
    expect(expiredAccess.writable).toBe(false);
  });

  it("a suspended tenant is locked out regardless of billing", async () => {
    await svc.setTenantStatus(B.tenantId, "suspended");
    const suspended = await access.getTenantAccess(B.tenantId);
    expect(suspended.state).toBe("suspended");
    expect(suspended.writable).toBe(false);
    await svc.setTenantStatus(B.tenantId, "active");
  });
});
