import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Field-label editor (PLAN.md §19.2, L3) against real MySQL: keys a site has
// sent are listed, a save is read back by the lead view, it is audited, and a
// second business can neither read nor write it.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("site field labels (MySQL integration)", () => {
  let db: (typeof import("@/db/client"))["db"];
  let labels: typeof import("./field-labels");
  let submissions: typeof import("@/modules/leads/submissions");
  let sitesMod: typeof import("./sites");

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  const superadmin = { userId: "sa-test", impersonatorUserId: null } as const;

  let ctxA: TenantContext;
  let ctxB: TenantContext;
  let siteA: string;
  let dealId: string;
  let contactId: string;

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    labels = await import("./field-labels");
    submissions = await import("@/modules/leads/submissions");
    sitesMod = await import("./sites");
    const { newId } = await import("@/lib/ids");
    const { createTenant } = await import("@/modules/tenancy/tenants");
    const { buildSystemTenantContext } = await import("@/modules/tenancy/context");
    const { seedDefaultPipeline, listStagesForPipeline } = await import("@/modules/crm/pipelines");
    const { ingestLeadForSite } = await import("./ingest");

    const tenantA = await createTenant(superadmin, { name: "Labels A", slug: `fl-a-${newId()}` });
    const tenantB = await createTenant(superadmin, { name: "Labels B", slug: `fl-b-${newId()}` });
    ctxA = (await buildSystemTenantContext(tenantA!.id))!;
    ctxB = (await buildSystemTenantContext(tenantB!.id))!;

    const pipeline = await seedDefaultPipeline(ctxA);
    const stage = (await listStagesForPipeline(ctxA, pipeline!.id))[0];
    const created = await sitesMod.createSite(ctxA, {
      name: "Tasación",
      slug: `tasacion-${newId()}`,
      defaultPipelineId: pipeline!.id,
      defaultStageId: stage.id,
    });
    siteA = created.id;
    const site = (await sitesMod.getSite(ctxA, siteA))!;
    const outcome = await ingestLeadForSite(site, {
      name: "María",
      phone: "0981 777 123",
      message: "Quiero tasar",
      idempotency_key: `idem-${newId()}`,
      fields: { finalidad: "Venta", ciudad: "Lambaré", tipo_de_propiedad: "Casa" },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    dealId = outcome.result.dealId!;
    contactId = outcome.result.contactId;
  });

  afterAll(async () => {
    if (!db) return;
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  it("lists the keys the site sent plus the message", async () => {
    const rows = await labels.getSiteFieldRows(ctxA, siteA);
    expect(rows!.map((row) => row.key).sort()).toEqual(
      ["ciudad", "finalidad", "message", "tipo_de_propiedad"].sort(),
    );
    expect(rows!.every((row) => row.label === "" && !row.prominent)).toBe(true);
  });

  it("saves labels and prominence, and the lead view reads them back", async () => {
    const result = await labels.saveSiteFieldSettings(ctxA, siteA, [
      { key: "tipo_de_propiedad", label: "Tipo de inmueble", prominent: false },
      { key: "ciudad", label: "Ciudad del inmueble", prominent: true },
      { key: "finalidad", label: "", prominent: true },
      { key: "message", label: "", prominent: true },
    ]);
    expect(result).toEqual({
      ok: true,
      changed: ["tipo_de_propiedad", "ciudad", "finalidad", "message"],
    });

    const [row] = await submissions.listLeadSubmissionsForDeal(ctxA, dealId);
    const [view] = await submissions.buildLeadSubmissionViews(ctxA, [row], null, {
      finalidad: "Finalidad",
    });
    const byKey = new Map(view.rows.map((r) => [r.key, r]));
    expect(byKey.get("tipo_de_propiedad")).toMatchObject({ label: "Tipo de inmueble", prominent: false });
    expect(byKey.get("ciudad")).toMatchObject({ label: "Ciudad del inmueble", prominent: true });
    expect(byKey.get("finalidad")).toMatchObject({ label: "Finalidad", prominent: true });
    expect(view.messageProminent).toBe(true);
    expect(view.rows.slice(0, 2).every((r) => r.prominent)).toBe(true);

    const reread = await labels.getSiteFieldRows(ctxA, siteA);
    expect(reread!.find((r) => r.key === "ciudad")).toMatchObject({
      label: "Ciudad del inmueble",
      prominent: true,
    });
  });

  it("audits the change and does nothing (no audit) for a no-op save", async () => {
    const { listAuditLogForTenant } = await import("@/modules/tenancy/audit");
    const countFor = async () =>
      (await listAuditLogForTenant(ctxA.tenantId, 200)).filter(
        (entry) => entry.action === "site.field_labels.update" && entry.entityId === siteA,
      ).length;
    expect(await countFor()).toBe(1);
    await labels.saveSiteFieldSettings(ctxA, siteA, [
      { key: "ciudad", label: "Ciudad del inmueble", prominent: true },
    ]);
    expect(await countFor()).toBe(1);
  });

  it("rejects over-long labels, bad keys and keys the site never sent", async () => {
    expect(
      await labels.saveSiteFieldSettings(ctxA, siteA, [
        { key: "ciudad", label: "x".repeat(81), prominent: false },
      ]),
    ).toEqual({ ok: false, error: "labelTooLong" });
    expect(
      await labels.saveSiteFieldSettings(ctxA, siteA, [{ key: "__proto__", label: "x", prominent: false }]),
    ).toEqual({ ok: false, error: "keyInvalid" });
    expect(
      await labels.saveSiteFieldSettings(ctxA, siteA, [{ key: "nunca_enviado", label: "x", prominent: false }]),
    ).toEqual({ ok: false, error: "keyUnknown" });
    // A dictionary key is accepted even if this site has not sent it yet.
    expect((await labels.saveSiteFieldSettings(ctxA, siteA, [{ key: "barrio", label: "Zona", prominent: false }])).ok).toBe(true);
  });

  it("stores an HTML label verbatim as text", async () => {
    const html = `<b>Ciudad</b>`;
    await labels.saveSiteFieldSettings(ctxA, siteA, [{ key: "ciudad", label: html, prominent: true }]);
    const rows = await labels.getSiteFieldRows(ctxA, siteA);
    expect(rows!.find((r) => r.key === "ciudad")!.label).toBe(html);
  });

  it("does not let another business read or write the site's settings", async () => {
    expect(await labels.getSiteFieldRows(ctxB, siteA)).toBeNull();
    expect(
      await labels.saveSiteFieldSettings(ctxB, siteA, [{ key: "ciudad", label: "Hackeado", prominent: true }]),
    ).toEqual({ ok: false, error: "siteNotFound" });
    expect(
      await labels.saveSiteFieldSettings(ctxA, "no-such-site-id", [{ key: "ciudad", label: "x", prominent: false }]),
    ).toEqual({ ok: false, error: "siteNotFound" });

    const site = (await sitesMod.getSite(ctxA, siteA))!;
    expect(JSON.stringify(site.settings)).not.toContain("Hackeado");
    void contactId;
  });
});
