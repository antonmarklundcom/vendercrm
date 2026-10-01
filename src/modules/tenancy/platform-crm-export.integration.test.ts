import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The audited CSV export's merge gate (PLAN.md §19.5 C3), on real MySQL like
// platform-crm.integration.test.ts: with two accounts, the export holds
// exactly the rows the same filters list (never more, never another
// account's), with the full message and every field; the cap refuses at
// 5,001 and allows exactly 5,000, never cutting; every call writes one
// `platform.crm.exported` audit row with the filters and the count and no
// row data; a non-superadmin reads and audits nothing.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("platform CRM export (MySQL integration)", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let reader: typeof import("./platform-crm");
  let csv: typeof import("@/app/(superadmin)/platform-leads/export-csv");
  let newId: () => string;

  type SuperadminContext = import("./context").SuperadminContext;

  let sa: SuperadminContext;
  let notSuperadmin: SuperadminContext;
  let tenantAId: string;
  let tenantBId: string;
  let tenantCapId: string;
  let siteAId: string;
  let capSiteId: string;
  let capContactId: string;
  let leadA: { contactId: string; dealId: string; submissionId: string };
  let leadB: { contactId: string; dealId: string; submissionId: string };
  const phoneA = `0981${Math.floor(100000 + Math.random() * 899999)}`;
  const phoneB = `0982${Math.floor(100000 + Math.random() * 899999)}`;
  const phoneCap = `0983${Math.floor(100000 + Math.random() * 899999)}`;
  const runTag = `pexp${Date.now()}`;
  const longMessage =
    `Hola, quiero tasar mi casa "grande" en Lambaré 🏠\n` +
    "Tiene tres dormitorios, dos baños, patio, quincho y garaje para dos autos. ".repeat(4) +
    "Fin del mensaje.";

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    reader = await import("./platform-crm");
    csv = await import("@/app/(superadmin)/platform-leads/export-csv");
    ({ newId } = await import("@/lib/ids"));
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

    async function seedAccount(name: string, domain: string, phone: string, lead: Record<string, unknown>) {
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
        { phone, idempotency_key: `idem-${newId()}`, ...lead },
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

    const a = await seedAccount("Export A", "export-a.com.py", phoneA, {
      name: `=${runTag} Ana`,
      email: "ana@ejemplo.com",
      message: longMessage,
      utm_source: `${runTag}-google`,
      utm_campaign: "otoño",
      fields: { finalidad: "Venta", ciudad: "Lambaré", barrio: "Centro", tipo: "Casa" },
    });
    const b = await seedAccount("Export B", "export-b.com.py", phoneB, {
      name: `${runTag} Bruno`,
      email: "bruno@ejemplo.com",
      message: "Alquiler",
      utm_source: `${runTag}-meta`,
      fields: { finalidad: "Alquiler" },
    });
    const cap = await seedAccount("Export Cap", "export-cap.com.py", phoneCap, {
      name: `${runTag} Cap`,
      message: "uno",
    });
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    tenantCapId = cap.tenantId;
    siteAId = a.siteId;
    capSiteId = cap.siteId;
    capContactId = cap.lead.contactId;
    leadA = a.lead;
    leadB = b.lead;
  });

  afterAll(async () => {
    if (!db) return;
    if (tenantCapId) {
      await db.delete(schema.leadSubmissions).where(eq(schema.leadSubmissions.tenantId, tenantCapId));
    }
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  const both = () => ({ tenantIds: [tenantAId, tenantBId] });

  async function exportedAudit() {
    return db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.actorUserId, sa.userId), eq(schema.auditLog.action, "platform.crm.exported")));
  }

  async function exportOk(filters: import("./platform-crm").PlatformCrmFilters) {
    const result = await reader.exportPlatformLeads(sa, filters);
    if (!result.ok) throw new Error(`export refused: ${result.reason}`);
    return result;
  }

  it("exports the same rows, in the same order, as the list for the same filters", async () => {
    const cases: Array<import("./platform-crm").PlatformCrmFilters> = [
      both(),
      { tenantIds: [tenantAId] },
      { tenantIds: [tenantBId] },
      { ...both(), days: 7 },
      { ...both(), source: `site:${siteAId}` },
      { ...both(), status: "open" },
      { ...both(), status: "won" },
      { ...both(), utmSource: `${runTag}-me` },
      { utmSource: `${runTag}-` },
      { ...both(), q: `${runTag} Bruno` },
      { ...both(), q: phoneA },
      { ...both(), from: new Date("2020-01-01T00:00:00Z"), to: new Date("2020-02-01T00:00:00Z") },
    ];
    const now = new Date();
    for (const filters of cases) {
      const listed = await reader.listPlatformLeads(sa, filters, 1, now);
      expect(listed.total).toBeLessThanOrEqual(listed.pageSize);
      const exported = await reader.exportPlatformLeads(sa, filters, now);
      if (!exported.ok) throw new Error(`export refused: ${exported.reason}`);
      expect(exported.rows.map((row) => row.id), JSON.stringify(filters)).toEqual(
        listed.rows.map((row) => row.id),
      );
      expect(exported.filters).toEqual(listed.filters);
    }

    expect((await exportOk({ tenantIds: [tenantAId] })).rows.map((row) => row.id)).toEqual([leadA.submissionId]);
    expect((await exportOk({ ...both(), source: `site:${siteAId}` })).rows.map((row) => row.id)).toEqual([
      leadA.submissionId,
    ]);
    expect((await exportOk({ ...both(), status: "won" })).rows).toEqual([]);
    expect((await exportOk({ ...both(), q: `${runTag} Bruno` })).rows.map((row) => row.id)).toEqual([
      leadB.submissionId,
    ]);
    expect(
      (await exportOk({ utmSource: `${runTag}-` })).rows.map((row) => row.id).sort(),
    ).toEqual([leadA.submissionId, leadB.submissionId].sort());
  });

  it("carries the full message and every field, where the list has previews", async () => {
    const listed = (await reader.listPlatformLeads(sa, { tenantIds: [tenantAId] })).rows[0];
    const exported = (await exportOk({ tenantIds: [tenantAId] })).rows[0];
    expect(longMessage.length).toBeGreaterThan(120);
    // MySQL's left() counts characters, so the emoji is one, not two.
    expect(listed.message).toBe([...longMessage].slice(0, 120).join(""));
    expect(exported.message).toBe(longMessage);
    expect(listed.fields).toHaveLength(2);
    // In the JSON column's key order (MySQL normalizes it), all of them, whole.
    expect([...exported.fields].sort((x, y) => x.key.localeCompare(y.key))).toEqual([
      { key: "barrio", value: "Centro" },
      { key: "ciudad", value: "Lambaré" },
      { key: "finalidad", value: "Venta" },
      { key: "tipo", value: "Casa" },
    ]);
    expect(exported).toMatchObject({
      tenantId: tenantAId,
      tenantName: "Export A",
      dealId: leadA.dealId,
      dealStatus: "open",
      utmCampaign: "otoño",
      origin: { kind: "site", domain: "export-a.com.py" },
    });
  });

  it("writes a CSV of only the filtered account, neutralized and quoted", async () => {
    const file = csv.platformLeadsCsv((await exportOk({ tenantIds: [tenantAId] })).rows);
    expect(file.startsWith("﻿received_at,account,")).toBe(true);
    expect(file).toContain(`'=${runTag} Ana`);
    expect(file).toContain(`"${longMessage.replaceAll('"', '""')}"`);
    const fieldsCell = file.match(/"((?:finalidad|ciudad|barrio|tipo): [^"]*)"/)![1];
    expect(fieldsCell.split("\n").sort()).toEqual([
      "barrio: Centro",
      "ciudad: Lambaré",
      "finalidad: Venta",
      "tipo: Casa",
    ]);
    expect(file).toContain("Export A");
    expect(file).not.toContain("Export B");
    expect(file).not.toContain(`${runTag} Bruno`);
    expect(file).not.toContain(phoneB.slice(1));
  });

  it("writes exactly one audit row per export, with the filters and the count and no row data", async () => {
    const before = new Set((await exportedAudit()).map((row) => row.id));
    await exportOk({ tenantIds: [tenantAId], days: 7 });
    const after = await exportedAudit();
    expect(after).toHaveLength(before.size + 1);

    const entry = after.find((row) => !before.has(row.id))!;
    expect(entry.entity).toBe("leads");
    expect(entry.tenantId).toBe(tenantAId);
    expect(entry.payload).toMatchObject({
      filters: { tenantIds: [tenantAId], days: 7, status: null, source: null, utmSource: null, q: null },
      rowCount: 1,
    });
    expect(entry.payload).not.toHaveProperty("refused");
    const stored = JSON.stringify(entry.payload);
    for (const rowData of ["ana@ejemplo.com", "Lambaré", "quiero tasar", `${runTag} Ana`, phoneA.slice(1), "otoño"]) {
      expect(stored).not.toContain(rowData);
    }

    // Several accounts: tenantId null, still one row.
    const beforeBoth = (await exportedAudit()).length;
    await exportOk(both());
    const afterBoth = await exportedAudit();
    expect(afterBoth).toHaveLength(beforeBoth + 1);
    expect(afterBoth.find((row) => !before.has(row.id) && row.id !== entry.id)!.tenantId).toBeNull();
  });

  it("allows exactly the cap and refuses one more, whole and audited, never truncated", async () => {
    const max = reader.PLATFORM_CRM_EXPORT_MAX_ROWS;
    expect(max).toBe(5000);

    // The seeded lead plus max - 1 more: exactly the cap in this account.
    const rows = Array.from({ length: max - 1 }, () => ({
      id: newId(),
      tenantId: tenantCapId,
      siteId: capSiteId,
      contactId: capContactId,
      payload: { lote: "cap" },
      utm: {},
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      await db.insert(schema.leadSubmissions).values(rows.slice(i, i + 1000));
    }

    const atCap = await exportOk({ tenantIds: [tenantCapId] });
    expect(atCap.rows).toHaveLength(max);
    expect(new Set(atCap.rows.map((row) => row.id)).size).toBe(max);
    expect(atCap.rows.every((row) => row.tenantId === tenantCapId)).toBe(true);
    expect(csv.platformLeadsCsv(atCap.rows).split("\r\n")).toHaveLength(max + 2);

    await db.insert(schema.leadSubmissions).values({
      id: newId(),
      tenantId: tenantCapId,
      siteId: capSiteId,
      contactId: capContactId,
      payload: {},
      utm: {},
    });

    const before = new Set((await exportedAudit()).map((row) => row.id));
    const refused = await reader.exportPlatformLeads(sa, { tenantIds: [tenantCapId] });
    expect(refused).toMatchObject({ ok: false, reason: "too_many_rows", total: max + 1, max });
    expect(refused).not.toHaveProperty("rows");

    const after = await exportedAudit();
    expect(after).toHaveLength(before.size + 1);
    const entry = after.find((row) => !before.has(row.id))!;
    expect(entry.tenantId).toBe(tenantCapId);
    expect(entry.payload).toMatchObject({
      filters: { tenantIds: [tenantCapId] },
      rowCount: 0,
      refused: "too_many_rows",
      total: max + 1,
    });
  });

  it("refuses a caller who is not a superadmin, before reading or auditing", async () => {
    const audited = () =>
      db.select().from(schema.auditLog).where(eq(schema.auditLog.actorUserId, notSuperadmin.userId));
    const before = (await audited()).length;

    await expect(reader.exportPlatformLeads(notSuperadmin, both())).rejects.toThrow("Superadmin required");
    await expect(
      reader.exportPlatformLeads({ userId: "0".repeat(26), impersonatorUserId: null }, both()),
    ).rejects.toThrow("Superadmin required");
    await expect(
      reader.exportPlatformLeads(
        { userId: sa.userId, impersonatorUserId: notSuperadmin.userId } as unknown as SuperadminContext,
        both(),
      ),
    ).rejects.toThrow("Superadmin required");

    expect(await audited()).toHaveLength(before);
  });
});
