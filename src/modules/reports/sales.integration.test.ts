import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The funnel, against a real database: a lead that became a deal that was
// won should be countable as exactly that, once, in the window it happened
// in — and not visible to any other business.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("sales report (MySQL integration)", () => {
  let reports: typeof import("./sales");
  let newId: (typeof import("@/lib/ids"))["newId"];

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  let ctx: TenantContext;
  let otherCtx: TenantContext;
  let wonStageId: string;

  beforeAll(async () => {
    reports = await import("./sales");
    ({ newId } = await import("@/lib/ids"));
    const { createTenant } = await import("@/modules/tenancy/tenants");
    const contacts = await import("@/modules/crm/contacts");
    const pipelines = await import("@/modules/crm/pipelines");
    const deals = await import("@/modules/crm/deals");

    const superadmin = { userId: "sa-reports", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, {
      name: `Reports ${newId()}`,
      slug: `reports-${newId()}`,
    });
    const other = await createTenant(superadmin, {
      name: `Other ${newId()}`,
      slug: `oreports-${newId()}`,
    });

    ctx = {
      tenantId: tenant!.id,
      userId: "rep-1",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };
    otherCtx = { ...ctx, tenantId: other!.id };

    const pipeline = await pipelines.createPipelineWithDefaultStages(ctx, "Ventas");
    const stageRows = await pipelines.listStagesForPipeline(ctx, pipeline!.id);
    const open = stageRows.find((stage) => !stage.isWon && !stage.isLost)!;
    wonStageId = stageRows.find((stage) => stage.isWon)!.id;

    const contact = await contacts.createContact(ctx, {
      name: "Lead ganado",
      phone: `0985${Math.floor(Math.random() * 900000) + 100000}`,
    });
    const deal = await deals.createDeal(ctx, {
      contactId: contact!.id,
      pipelineId: pipeline!.id,
      stageId: open.id,
      title: "Obra",
      value: 5_000_000,
      assignedUserId: "rep-1",
    });
    // Moving it into the won stage is what closes it — the report reads
    // won/lost from the stage, never from a status column.
    await deals.moveDeal(ctx, deal!.id, { toStageId: wonStageId, toPosition: 0 });
  });

  /**
   * A window that ends a minute out rather than at `now`.
   *
   * `closed_at` is a second-precision DATETIME and MySQL *rounds* on insert
   * (MariaDB truncates — which is why this passed locally and failed in CI):
   * a deal closed at 12:11:50.7 is stored as 12:11:51, half a second in the
   * future of the `now` the report window would have used. The production
   * window is right as it is — a deal drops out of "won this period" for at
   * most one second — but a test racing that boundary tests the clock, not
   * the report.
   */
  const window = () => ({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    to: new Date(Date.now() + 60 * 1000),
    days: 30,
  });

  it("counts the deal it created, in the window, once", async () => {
    const report = await reports.getSalesReport(ctx, window());

    expect(report.funnel.contactsCreated).toBe(1);
    expect(report.funnel.dealsOpened).toBe(1);
    expect(report.funnel.dealsWon).toBe(1);
    expect(report.funnel.dealsLost).toBe(0);
    expect(report.funnel.wonValue).toBe(5_000_000);
  });

  it("attributes it to the rep who owns it", async () => {
    const report = await reports.getSalesReport(ctx, window());
    const rep = report.byAgent.find((row) => row.userId === "rep-1");

    expect(rep).toBeDefined();
    expect(rep!.dealsWon).toBe(1);
    expect(rep!.wonValue).toBe(5_000_000);
  });

  it("shows another business none of it", async () => {
    const report = await reports.getSalesReport(otherCtx, window());

    expect(report.funnel.dealsWon).toBe(0);
    expect(report.funnel.wonValue).toBe(0);
    expect(report.byAgent).toEqual([]);
  });

  it("drops out of a window that ended before any of it happened", async () => {
    const past = {
      from: new Date("2020-01-01T00:00:00Z"),
      to: new Date("2020-02-01T00:00:00Z"),
      days: 31,
    };
    const report = await reports.getSalesReport(ctx, past);

    expect(report.funnel.dealsOpened).toBe(0);
    expect(report.funnel.dealsWon).toBe(0);
    expect(report.byMonth).toEqual([]);
  });

  it("gives the same answer from a shared deals/stages read as from its own", async () => {
    const current = window();
    const previous = reports.previousWindow(current);
    const base = reports.loadReportBase(ctx);

    const [sharedCurrent, sharedPrevious] = await Promise.all([
      reports.getSalesReport(ctx, current, {}, base),
      reports.getSalesReport(ctx, previous, {}, base),
    ]);

    expect(sharedCurrent).toEqual(await reports.getSalesReport(ctx, current));
    expect(sharedPrevious).toEqual(await reports.getSalesReport(ctx, previous));
    expect(sharedCurrent.funnel.dealsWon).toBe(1);
  });
});
