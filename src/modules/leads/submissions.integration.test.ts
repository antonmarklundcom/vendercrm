import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The lead card's reads (PLAN.md §19.2): a lead ingested the way
// tasacion.com.py sends it comes back whole, a second business cannot read
// it, and the contact timeline carries one lead entry and no empty
// "form_submission" twin. Real MySQL only, like the other module suites.
const hasDb = !!process.env.DATABASE_URL;

const TASACION_BODY = {
  name: "María Benítez",
  phone: "0981 123 456",
  email: "maria@example.com",
  message: "Quiero tasar mi casa",
  utm_source: "google",
  utm_campaign: "tasacion-asuncion",
  page_url: "https://tasacion.com.py/tasar-casa",
  fields: { finalidad: "Venta", ciudad: "Lambaré", campo_extra: "valor extra" },
};

describe.skipIf(!hasDb)("lead submissions reads (MySQL integration)", () => {
  let db: (typeof import("@/db/client"))["db"];
  let submissions: typeof import("./submissions");

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  const superadmin = { userId: "sa-test", impersonatorUserId: null } as const;

  let ctxA: TenantContext;
  let ctxB: TenantContext;
  let dealId: string;
  let contactId: string;

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    submissions = await import("./submissions");
    const { newId } = await import("@/lib/ids");
    const { createTenant } = await import("@/modules/tenancy/tenants");
    const { buildSystemTenantContext } = await import("@/modules/tenancy/context");
    const { seedDefaultPipeline, listStagesForPipeline } = await import("@/modules/crm/pipelines");
    const { createSite } = await import("@/modules/sites/sites");
    const { ingestLeadForSite } = await import("@/modules/sites/ingest");
    const { getSite } = await import("@/modules/sites/sites");

    const tenantA = await createTenant(superadmin, { name: "Lead View A", slug: `lv-a-${newId()}` });
    const tenantB = await createTenant(superadmin, { name: "Lead View B", slug: `lv-b-${newId()}` });
    ctxA = (await buildSystemTenantContext(tenantA!.id))!;
    ctxB = (await buildSystemTenantContext(tenantB!.id))!;

    const pipeline = await seedDefaultPipeline(ctxA);
    const stage = (await listStagesForPipeline(ctxA, pipeline!.id))[0];
    const created = await createSite(ctxA, {
      name: "Tasación",
      slug: `tasacion-${newId()}`,
      domain: "tasacion.com.py",
      defaultPipelineId: pipeline!.id,
      defaultStageId: stage.id,
    });
    const site = (await getSite(ctxA, created.id))!;

    const outcome = await ingestLeadForSite(site, {
      ...TASACION_BODY,
      idempotency_key: `idem-${newId()}`,
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

  it("returns the ingested lead with every field for its deal", async () => {
    const rows = await submissions.listLeadSubmissionsForDeal(ctxA, dealId);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual(TASACION_BODY.fields);
    expect(rows[0].notes).toBe(TASACION_BODY.message);

    const [view] = await submissions.buildLeadSubmissionViews(
      ctxA,
      rows,
      { name: TASACION_BODY.name, email: TASACION_BODY.email, phone: "+595981123456" },
      { finalidad: "Finalidad" },
    );
    expect(view.origin).toMatchObject({ kind: "site", name: "Tasación", domain: "tasacion.com.py" });
    // MySQL JSON columns do not keep key order (shorter keys come back first),
    // so assert on the set of keys, not their position.
    expect(view.rows.map((row) => row.key).sort()).toEqual(["campo_extra", "ciudad", "finalidad"]);
    expect(view.rows.find((row) => row.key === "campo_extra")?.label).toBe("Campo extra");
    expect(view.attribution.utmCampaign).toBe("tasacion-asuncion");
  });

  it("does not let another business read it", async () => {
    expect(await submissions.listLeadSubmissionsForDeal(ctxB, dealId)).toEqual([]);
    expect(await submissions.listLeadSubmissionsForContact(ctxB, contactId)).toEqual([]);
  });

  it("puts one lead entry, and no form_submission activity, on the contact timeline", async () => {
    const { getContactTimeline } = await import("@/modules/crm/timeline");
    const timeline = await getContactTimeline(ctxA, contactId);
    const leads = timeline.filter((entry) => entry.kind === "lead");
    expect(leads).toHaveLength(1);
    expect(
      timeline.filter(
        (entry) => entry.kind === "activity" && entry.activityType === "form_submission",
      ),
    ).toEqual([]);
  });
});
