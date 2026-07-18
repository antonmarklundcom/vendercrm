import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Extends the tenant-isolation merge gate (PLAN.md §3.3) to the CRM/forms
// tables added in 1C. DB-gated like the other integration suites.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("cross-tenant isolation — CRM", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let tenancy: typeof import("@/modules/tenancy/service");
  let crm: typeof import("./index");
  let tenantDb: (typeof import("@/modules/tenancy/db"))["tenantDb"];
  type TenantContext = import("@/modules/tenancy/types").TenantContext;

  let A: { tenantId: string; ctx: TenantContext };
  let B: { tenantId: string; ctx: TenantContext };

  const uniq = () => Math.random().toString(36).slice(2, 8);
  const ctxFor = (tenantId: string): TenantContext => ({
    tenantId,
    userId: "u",
    role: "admin",
    isSuperadmin: false,
    impersonatorUserId: null,
  });

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    tenancy = await import("@/modules/tenancy/service");
    crm = await import("./index");
    ({ tenantDb } = await import("@/modules/tenancy/db"));

    const s = uniq();
    const a = await tenancy.createTenant({
      name: "A",
      slug: `ca-${s}`,
      adminEmail: `ca-${s}@x.com`,
      adminPassword: "password123",
      adminName: "A",
    });
    const b = await tenancy.createTenant({
      name: "B",
      slug: `cb-${s}`,
      adminEmail: `cb-${s}@x.com`,
      adminPassword: "password123",
      adminName: "B",
    });
    A = { tenantId: a.tenantId, ctx: ctxFor(a.tenantId) };
    B = { tenantId: b.tenantId, ctx: ctxFor(b.tenantId) };
  });

  afterAll(async () => {
    if (!db) return;
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  it("seeds an isolated default pipeline per tenant", async () => {
    const pa = await crm.getDefaultPipeline(A.ctx);
    const pb = await crm.getDefaultPipeline(B.ctx);
    expect(pa).toBeTruthy();
    expect(pb).toBeTruthy();
    expect(pa!.id).not.toBe(pb!.id);
    // A cannot see B's pipeline through its scoped view.
    const aPipelines = await crm.listPipelines(A.ctx);
    expect(aPipelines.every((p) => p.tenantId === A.tenantId)).toBe(true);
    expect(aPipelines.some((p) => p.id === pb!.id)).toBe(false);
  });

  it("contacts are not visible or mutable across tenants", async () => {
    const cbId = await crm.createContact(B.ctx, {
      name: "B contact",
      phone: `+59598${uniq()}`,
    });
    // A's scoped list never contains B's contact.
    const aContacts = await crm.listContacts(A.ctx);
    expect(aContacts.some((c) => c.id === cbId)).toBe(false);
    // A can't fetch it directly either.
    expect(await crm.getContact(A.ctx, cbId)).toBeNull();
    // A's update can't touch it.
    await crm.updateContact(A.ctx, cbId, { name: "hacked" });
    const [row] = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, cbId));
    expect(row.name).toBe("B contact");
  });

  it("deals and stage moves stay within the tenant", async () => {
    const pb = (await crm.getDefaultPipeline(B.ctx))!;
    const stagesB = await crm.listStages(B.ctx, pb.id);
    const contactB = await crm.createContact(B.ctx, { name: "Lead B" });
    const dealB = await crm.createDeal(B.ctx, {
      contactId: contactB,
      pipelineId: pb.id,
      stageId: stagesB[0].id,
      title: "Deal B",
    });

    // A tries to move B's deal — no-op across the boundary.
    await crm.moveDeal(A.ctx, dealB, stagesB[1].id).catch(() => {});
    const [row] = await db
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, dealB));
    expect(row.stageId).toBe(stagesB[0].id);

    // A's pipeline view never includes B's deal.
    const pa = (await crm.getDefaultPipeline(A.ctx))!;
    const aDeals = await crm.listDealsByPipeline(A.ctx, pa.id);
    expect(aDeals.some((d) => d.id === dealB)).toBe(false);
  });

  it("contact create forces the caller's tenantId", async () => {
    const id = await crm.createContact(A.ctx, { name: "forced" });
    const [row] = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, id));
    expect(row.tenantId).toBe(A.tenantId);
    void tenantDb; // referenced to keep import meaningful
  });
});
