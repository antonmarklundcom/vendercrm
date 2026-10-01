import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// "Abrir en la cuenta" against the real tables (PLAN.md §19.4, §3.3): with a
// live membership the active business moves and the deal is confirmed inside
// it; without one nothing moves and the audited impersonation takes over; a
// deal id from another account is indistinguishable from one that does not
// exist. Only the session and the Better Auth impersonation call are stubbed.
const hasDb = !!process.env.DATABASE_URL;

const hoisted = vi.hoisted(() => ({ sessionUserId: "" }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: hoisted.sessionUserId, tenantId: null, isSuperadmin: true },
        session: { impersonatedBy: null },
      }),
    },
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const startImpersonation = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/modules/auth/impersonation", () => ({ startImpersonation }));

describe.skipIf(!hasDb)("openInAccountAction (MySQL integration)", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let openInAccountAction: typeof import("./actions").openInAccountAction;

  let saId: string;
  let adminBId: string;
  let tenantAId: string;
  let tenantBId: string;
  let dealAId: string;
  let dealBId: string;
  const runTag = `oia${Date.now()}`;

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    ({ openInAccountAction } = await import("./actions"));
    const { newId } = await import("@/lib/ids");
    const { createTenant } = await import("@/modules/tenancy/tenants");
    const { addMembership } = await import("@/modules/tenancy/memberships");
    const { buildSystemTenantContext } = await import("@/modules/tenancy/context");
    const { seedDefaultPipeline, listStagesForPipeline } = await import("@/modules/crm/pipelines");
    const { createSite, getSite } = await import("@/modules/sites/sites");
    const { ingestLeadForSite } = await import("@/modules/sites/ingest");

    saId = newId();
    adminBId = newId();
    await db.insert(schema.users).values([
      { id: saId, email: `sa-${saId}@example.com`, name: "Owner", isSuperadmin: true },
      { id: adminBId, email: `admin-${adminBId}@example.com`, name: "Admin B", role: "admin" },
    ]);
    const sa = { userId: saId, impersonatorUserId: null };

    async function seedAccount(name: string, domain: string) {
      const tenant = await createTenant(sa, { name, slug: `${runTag}-${newId()}`.toLowerCase() });
      const ctx = (await buildSystemTenantContext(tenant!.id))!;
      const pipeline = await seedDefaultPipeline(ctx);
      const stage = (await listStagesForPipeline(ctx, pipeline!.id))[0];
      const created = await createSite(ctx, {
        name,
        slug: `site-${newId()}`.toLowerCase(),
        domain,
        defaultPipelineId: pipeline!.id,
        defaultStageId: stage.id,
      });
      const site = (await getSite(ctx, created.id))!;
      const outcome = await ingestLeadForSite(
        site,
        {
          phone: `0981${Math.floor(100000 + Math.random() * 899999)}`,
          name: `${runTag} ${name}`,
          idempotency_key: `idem-${newId()}`,
        },
        {},
        "key",
        { skipHealth: true },
      );
      if (!outcome.ok) throw new Error(outcome.error);
      return { tenantId: tenant!.id, dealId: outcome.result.dealId! };
    }

    const a = await seedAccount("Cuenta A", `${runTag}-a.com.py`);
    const b = await seedAccount("Cuenta B", `${runTag}-b.com.py`);
    tenantAId = a.tenantId;
    dealAId = a.dealId;
    tenantBId = b.tenantId;
    dealBId = b.dealId;

    // The owner works inside A (a live membership) and not inside B; B has its
    // own admin to "ver como".
    await addMembership({ userId: saId, tenantId: tenantAId, role: "admin" });
    await addMembership({ userId: adminBId, tenantId: tenantBId, role: "admin" });
  });

  beforeEach(async () => {
    hoisted.sessionUserId = saId;
    startImpersonation.mockClear();
    await db.update(schema.users).set({ tenantId: null }).where(eq(schema.users.id, saId));
  });

  afterAll(async () => {
    if (!db) return;
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  const run = async (tenantId: string, dealId: string) => {
    try {
      await openInAccountAction(tenantId, dealId);
      return "returned";
    } catch (err) {
      return (err as Error).message;
    }
  };

  const activeTenant = async () =>
    (await db.select({ tenantId: schema.users.tenantId }).from(schema.users).where(eq(schema.users.id, saId)))[0]
      .tenantId;

  const openedRows = (tenantId: string, dealId: string) =>
    db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.actorUserId, saId),
          eq(schema.auditLog.action, "platform.deal.opened_in_account"),
          eq(schema.auditLog.tenantId, tenantId),
          eq(schema.auditLog.entityId, dealId),
        ),
      );

  it("with a membership: switches into the account and lands on the deal", async () => {
    expect(await run(tenantAId, dealAId)).toBe(`NEXT_REDIRECT:/pipeline/${dealAId}`);
    expect(await activeTenant()).toBe(tenantAId);
    expect(startImpersonation).not.toHaveBeenCalled();
    const [row] = await openedRows(tenantAId, dealAId);
    expect(row.payload).toEqual({ tenantId: tenantAId, dealId: dealAId, via: "membership" });
  });

  it("with a membership but a deal of another account: the same not-found as a nonexistent id", async () => {
    const foreign = await run(tenantAId, dealBId);
    const missing = await run(tenantAId, "01HZZZZZZZZZZZZZZZZZZZZZZZ");
    expect(foreign).toBe("NEXT_NOT_FOUND");
    expect(missing).toBe(foreign);
    expect(await openedRows(tenantAId, dealBId)).toHaveLength(0);
  });

  it("without a membership: does not switch, and falls back to 'ver como' on the account's admin", async () => {
    expect(await run(tenantBId, dealBId)).toBe(`NEXT_REDIRECT:/pipeline/${dealBId}`);
    expect(await activeTenant()).toBeNull();
    expect(startImpersonation).toHaveBeenCalledWith(adminBId, tenantBId);
    const [row] = await openedRows(tenantBId, dealBId);
    expect(row.payload).toEqual({ tenantId: tenantBId, dealId: dealBId, via: "impersonation" });
  });

  it("without a membership and a deal of another account: not-found, nobody is impersonated", async () => {
    expect(await run(tenantBId, dealAId)).toBe("NEXT_NOT_FOUND");
    expect(startImpersonation).not.toHaveBeenCalled();
    expect(await activeTenant()).toBeNull();
  });
});
