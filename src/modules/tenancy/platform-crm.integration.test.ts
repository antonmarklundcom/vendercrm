import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The cross-account reader's merge gate (PLAN.md §19.4, §3.3): a superadmin
// sees rows from two accounts, each labelled with the right one; a
// non-superadmin reads nothing; a mismatched (tenant, deal) pair and a forged
// cross-tenant foreign key join nothing; every call writes exactly one audit
// row and no row data. Real MySQL only, like the other isolation suites.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("platform CRM reader (MySQL integration)", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let reader: typeof import("./platform-crm");

  type SuperadminContext = import("./context").SuperadminContext;

  let sa: SuperadminContext;
  let notSuperadmin: SuperadminContext;
  let tenantAId: string;
  let tenantBId: string;
  let siteAId: string;
  let leadA: { contactId: string; dealId: string; submissionId: string };
  let leadB: { contactId: string; dealId: string; submissionId: string };
  const phoneA = `0981${Math.floor(100000 + Math.random() * 899999)}`;
  const phoneB = `0982${Math.floor(100000 + Math.random() * 899999)}`;
  const runTag = `pcrm${Date.now()}`;

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    reader = await import("./platform-crm");
    const { newId } = await import("@/lib/ids");
    const { createTenant } = await import("./tenants");
    const { buildSystemTenantContext } = await import("./context");
    const { seedDefaultPipeline, listStagesForPipeline } = await import("@/modules/crm/pipelines");
    const { createSite, getSite } = await import("@/modules/sites/sites");
    const { ingestLeadForSite } = await import("@/modules/sites/ingest");

    const saId = newId();
    const userId = newId();
    await db.insert(schema.users).values([
      { id: saId, email: `sa-${saId}@example.com`, name: "Owner", isSuperadmin: true },
      { id: userId, email: `admin-${userId}@example.com`, name: "Tenant admin", role: "admin" },
    ]);
    sa = { userId: saId, impersonatorUserId: null };
    notSuperadmin = { userId, impersonatorUserId: null };

    async function seedAccount(name: string, domain: string, phone: string, fields: Record<string, unknown>) {
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
          phone,
          name: `${runTag} ${name}`,
          email: "juan@gmail",
          message: "Quiero tasar mi casa",
          utm_source: `${runTag}-google`,
          idempotency_key: `idem-${newId()}`,
          fields,
        },
        {},
        "key",
        { skipHealth: true },
      );
      if (!outcome.ok) throw new Error(outcome.error);
      return {
        tenantId: tenant!.id,
        siteId: site.id,
        lead: {
          contactId: outcome.result.contactId,
          dealId: outcome.result.dealId!,
          submissionId: outcome.result.submissionId,
        },
      };
    }

    const a = await seedAccount("Tasación A", "tasacion-a.com.py", phoneA, { finalidad: "Venta", ciudad: "Lambaré" });
    const b = await seedAccount("Tasación B", "tasacion-b.com.py", phoneB, { finalidad: "Alquiler" });
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    siteAId = a.siteId;
    leadA = a.lead;
    leadB = b.lead;
  });

  afterAll(async () => {
    if (!db) return;
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  const both = () => ({ tenantIds: [tenantAId, tenantBId] });

  async function auditRows(action: string) {
    return db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.actorUserId, sa.userId), eq(schema.auditLog.action, action)));
  }

  it("lists leads from both accounts, each labelled with its own account", async () => {
    const page = await reader.listPlatformLeads(sa, both());
    const a = page.rows.find((row) => row.id === leadA.submissionId);
    const b = page.rows.find((row) => row.id === leadB.submissionId);
    expect(a).toMatchObject({
      tenantId: tenantAId,
      tenantName: "Tasación A",
      dealId: leadA.dealId,
      dealStatus: "open",
      email: "juan@gmail",
      origin: { kind: "site", domain: "tasacion-a.com.py" },
    });
    expect(a!.needsReview).toEqual(["email_invalid"]);
    expect(a!.fields.map((field) => field.key).sort()).toEqual(["ciudad", "finalidad"]);
    expect(b).toMatchObject({ tenantId: tenantBId, tenantName: "Tasación B" });
    expect(page.total).toBe(2);
    expect(page.pageSize).toBe(50);
  });

  it("filters by account, dropping an unknown account id", async () => {
    const page = await reader.listPlatformLeads(sa, {
      tenantIds: [tenantAId, "0".repeat(26), "not-an-id"],
    });
    expect(page.filters.tenantIds).toEqual([tenantAId]);
    expect(page.rows.every((row) => row.tenantId === tenantAId)).toBe(true);
    expect(page.rows.some((row) => row.id === leadA.submissionId)).toBe(true);
  });

  it("filters by site, status, utm_source and search", async () => {
    const bySite = await reader.listPlatformLeads(sa, { ...both(), source: `site:${siteAId}` });
    expect(bySite.rows.map((row) => row.id)).toEqual([leadA.submissionId]);

    expect((await reader.listPlatformLeads(sa, { ...both(), status: "won" })).rows).toEqual([]);
    expect((await reader.listPlatformDeals(sa, { ...both(), status: "open" })).total).toBe(2);

    const byUtm = await reader.listPlatformLeads(sa, { utmSource: `${runTag}-goo` });
    expect(byUtm.rows.map((row) => row.id).sort()).toEqual(
      [leadA.submissionId, leadB.submissionId].sort(),
    );

    const byName = await reader.listPlatformLeads(sa, { q: `${runTag} Tasación B` });
    expect(byName.rows.map((row) => row.id)).toEqual([leadB.submissionId]);
    const byPhone = await reader.listPlatformContacts(sa, { q: phoneA });
    expect(byPhone.rows.map((row) => row.id)).toEqual([leadA.contactId]);
  });

  it("is date-bounded: a custom range in the past returns nothing", async () => {
    const page = await reader.listPlatformLeads(sa, {
      ...both(),
      from: new Date("2020-01-01T00:00:00Z"),
      to: new Date("2020-02-01T00:00:00Z"),
    });
    expect(page.rows).toEqual([]);
    expect(page.filters.days).toBeNull();
  });

  it("lists deals and contacts from both accounts", async () => {
    const dealsPage = await reader.listPlatformDeals(sa, both());
    expect(dealsPage.rows.find((row) => row.id === leadA.dealId)).toMatchObject({
      tenantId: tenantAId,
      contactId: leadA.contactId,
      status: "open",
      siteDomain: "tasacion-a.com.py",
    });
    expect(dealsPage.rows.find((row) => row.id === leadB.dealId)?.tenantId).toBe(tenantBId);

    const contactsPage = await reader.listPlatformContacts(sa, both());
    expect(contactsPage.rows.find((row) => row.id === leadA.contactId)).toMatchObject({
      tenantName: "Tasación A",
      openDeals: 1,
      firstSiteDomain: "tasacion-a.com.py",
    });
    expect(contactsPage.rows.find((row) => row.id === leadB.contactId)?.tenantId).toBe(tenantBId);
  });

  it("reads one deal with its form data; a mismatched (account, deal) pair is null", async () => {
    const detail = await reader.getPlatformDeal(sa, tenantAId, leadA.dealId);
    expect(detail).toMatchObject({ id: leadA.dealId, tenantId: tenantAId });
    expect(detail!.leads).toHaveLength(1);
    expect(detail!.leads[0].rows.map((row) => row.key).sort()).toEqual(["ciudad", "finalidad"]);
    expect(detail!.leads[0].needsReview).toEqual(["email_invalid"]);

    expect(await reader.getPlatformDeal(sa, tenantAId, leadB.dealId)).toBeNull();
    expect(await reader.getPlatformDeal(sa, tenantBId, leadA.dealId)).toBeNull();
  });

  it("never joins another account's contact through a forged foreign key", async () => {
    const forgedDealId = (await import("@/lib/ids")).newId();
    const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.id, leadA.dealId));
    await db.insert(schema.deals).values({
      ...deal,
      id: forgedDealId,
      title: `${runTag} forged`,
      contactId: leadB.contactId,
    });

    expect(await reader.getPlatformDeal(sa, tenantAId, forgedDealId)).toBeNull();
    const page = await reader.listPlatformDeals(sa, both());
    expect(page.rows.some((row) => row.id === forgedDealId)).toBe(false);

    await db.delete(schema.deals).where(eq(schema.deals.id, forgedDealId));
  });

  it("refuses a caller who is not a superadmin, before reading or auditing", async () => {
    const before = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorUserId, notSuperadmin.userId));

    await expect(reader.listPlatformLeads(notSuperadmin, both())).rejects.toThrow("Superadmin required");
    await expect(reader.listPlatformDeals(notSuperadmin, both())).rejects.toThrow("Superadmin required");
    await expect(reader.listPlatformContacts(notSuperadmin, both())).rejects.toThrow("Superadmin required");
    await expect(reader.getPlatformDeal(notSuperadmin, tenantAId, leadA.dealId)).rejects.toThrow(
      "Superadmin required",
    );
    // A context whose user does not exist, and one claiming impersonation.
    await expect(
      reader.listPlatformLeads({ userId: "0".repeat(26), impersonatorUserId: null }, both()),
    ).rejects.toThrow("Superadmin required");
    await expect(
      reader.listPlatformLeads(
        { userId: sa.userId, impersonatorUserId: notSuperadmin.userId } as unknown as SuperadminContext,
        both(),
      ),
    ).rejects.toThrow("Superadmin required");

    const after = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorUserId, notSuperadmin.userId));
    expect(after).toHaveLength(before.length);
  });

  it("writes exactly one audit row per list call and per detail view, with no row data", async () => {
    const viewedBefore = new Set((await auditRows("platform.crm.viewed")).map((row) => row.id));
    await reader.listPlatformLeads(sa, { tenantIds: [tenantAId] });
    const viewed = await auditRows("platform.crm.viewed");
    expect(viewed).toHaveLength(viewedBefore.size + 1);

    const entry = viewed.find((row) => !viewedBefore.has(row.id))!;
    expect(entry.entity).toBe("leads");
    expect(entry.tenantId).toBe(tenantAId);
    expect(entry.payload).toMatchObject({ page: 1, rowCount: 1, total: 1 });
    const stored = JSON.stringify(entry.payload);
    for (const rowData of ["juan@gmail", "Lambaré", "Quiero tasar", phoneA.slice(1)]) {
      expect(stored).not.toContain(rowData);
    }

    const dealViewsBefore = (await auditRows("platform.deal.viewed")).length;
    await reader.getPlatformDeal(sa, tenantAId, leadA.dealId);
    const dealViews = await auditRows("platform.deal.viewed");
    expect(dealViews).toHaveLength(dealViewsBefore + 1);
    expect(dealViews.some((row) => row.entityId === leadA.dealId && row.tenantId === tenantAId)).toBe(true);
  });
});
