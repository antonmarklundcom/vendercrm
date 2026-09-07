import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Needs a real MySQL — same reason every other integration suite in this
// repo does.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("reports v2 (MySQL)", () => {
  let db: (typeof import("@/db/client"))["db"];
  let newId: (typeof import("@/lib/ids"))["newId"];
  let createTenant: (typeof import("@/modules/tenancy/tenants"))["createTenant"];
  let buildSystemTenantContext: (typeof import("@/modules/tenancy/context"))["buildSystemTenantContext"];
  let createContact: (typeof import("@/modules/crm/contacts"))["createContact"];
  let listPipelines: (typeof import("@/modules/crm/pipelines"))["listPipelines"];
  let seedDefaultPipeline: (typeof import("@/modules/crm/pipelines"))["seedDefaultPipeline"];
  let listStagesForPipeline: (typeof import("@/modules/crm/pipelines"))["listStagesForPipeline"];
  let createDeal: (typeof import("@/modules/crm/deals"))["createDeal"];
  let moveDeal: (typeof import("@/modules/crm/deals"))["moveDeal"];
  let getSalesReport: (typeof import("./sales"))["getSalesReport"];
  let reportTableToCsv: (typeof import("./export"))["reportTableToCsv"];

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  type ReportWindow = import("./sales").ReportWindow;
  const superadmin = { userId: "sa-test", impersonatorUserId: null } as const;

  let ctx: TenantContext;
  let pipelineId: string;
  let agentUserId: string;

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    ({ newId } = await import("@/lib/ids"));
    ({ createTenant } = await import("@/modules/tenancy/tenants"));
    ({ buildSystemTenantContext } = await import("@/modules/tenancy/context"));
    ({ createContact } = await import("@/modules/crm/contacts"));
    ({ listPipelines, listStagesForPipeline, seedDefaultPipeline } = await import(
      "@/modules/crm/pipelines"
    ));
    ({ createDeal, moveDeal } = await import("@/modules/crm/deals"));
    ({ getSalesReport } = await import("./sales"));
    ({ reportTableToCsv } = await import("./export"));

    const tenant = await createTenant(superadmin, {
      name: "Reports Co",
      slug: `reports-${newId()}`,
    });
    ctx = (await buildSystemTenantContext(tenant!.id))!;
    agentUserId = ctx.userId;

    await seedDefaultPipeline(ctx);
    const [pipeline] = await listPipelines(ctx);
    pipelineId = pipeline!.id;
    const stages = await listStagesForPipeline(ctx, pipelineId);
    const wonStage = stages.find((s) => s.isWon)!;

    const contact = await createContact(ctx, { name: "Cliente Reportes", phone: `0981${newId().slice(0, 6)}` });
    const deal = await createDeal(ctx, {
      pipelineId,
      stageId: stages[0]!.id,
      contactId: contact!.id,
      title: "Negocio de prueba",
      value: 1_000_000,
      assignedUserId: agentUserId,
    });
    await moveDeal(ctx, deal!.id, { toStageId: wonStage.id, toPosition: 0 });
  });

  afterAll(async () => {
    if (!db) return;
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  /** `to` a minute into the future — MySQL's `datetime` column has no
   *  fractional-seconds precision and can round a value up to the next
   *  whole second, so a row written "now" can read back a hair after a
   *  window's `to` computed from that same instant (the existing
   *  `sales.integration.test.ts` window() helper takes the same buffer,
   *  for the same reason). */
  function window(): ReportWindow {
    return {
      from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      to: new Date(Date.now() + 60 * 1000),
      days: 30,
    };
  }

  it("the page's report and the export CSV agree for the same window and filters", async () => {
    const filters = { pipelineId, agentUserId };

    // Simulates two separate requests reading the same URL — the page and
    // /api/exports/reports/[table] — each building its own report from
    // scratch through the identical query path.
    const pageReport = await getSalesReport(ctx, window(), filters);
    const exportReport = await getSalesReport(ctx, window(), filters);

    expect(pageReport.funnel.dealsWon).toBe(1);
    expect(exportReport.byAgent).toEqual(pageReport.byAgent);
    expect(exportReport.stageConversion).toEqual(pageReport.stageConversion);

    const csv = reportTableToCsv("agents", exportReport);
    const csvRows = csv.split("\r\n").slice(1); // drop the header row
    expect(csvRows).toHaveLength(pageReport.byAgent.length);
    expect(csv).toContain(String(pageReport.byAgent[0]!.wonValue));
  });

  it("the pipeline filter narrows the funnel to that pipeline's deals only", async () => {
    const scoped = await getSalesReport(ctx, window(), { pipelineId });
    const unscoped = await getSalesReport(ctx, window(), {});

    expect(scoped.funnel.dealsWon).toBeGreaterThan(0);
    expect(scoped.stageConversion.length).toBeGreaterThan(0);
    // Unscoped has no pipeline chosen, so no funnel is computed at all.
    expect(unscoped.stageConversion).toEqual([]);
  });
});
