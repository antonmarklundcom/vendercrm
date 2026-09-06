import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Pipeline board polish (PLAN.md §15.8 P5): column value totals, against
// real deal rows — the arithmetic the board's own client-side total mirrors
// (PipelineBoard.tsx recomputes it reactively from live column state; this
// is the same sum, tested against the database instead of a React tree,
// which this repo has no component-test harness for).
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("pipeline board totals (MySQL integration)", () => {
  let newId: (typeof import("@/lib/ids"))["newId"];
  let deals: typeof import("./deals");
  let pipelines: typeof import("./pipelines");
  let contacts: typeof import("./contacts");

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  let ctx: TenantContext;
  let pipelineId: string;
  let contactId: string;
  let openStageId: string;
  let laterStageId: string;

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    deals = await import("./deals");
    pipelines = await import("./pipelines");
    contacts = await import("./contacts");
    const { createTenant } = await import("@/modules/tenancy/tenants");

    const superadmin = { userId: "sa-p5", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, {
      name: `Board ${newId()}`,
      slug: `board-${newId()}`,
    });
    ctx = {
      tenantId: tenant!.id,
      userId: "system",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };

    const pipeline = await pipelines.createPipelineWithDefaultStages(ctx, "Ventas");
    pipelineId = pipeline!.id;
    const stages = (await pipelines.listStagesForPipeline(ctx, pipelineId)).filter(
      (s) => !s.isWon && !s.isLost,
    );
    openStageId = stages[0].id;
    laterStageId = stages[1].id;

    const contact = await contacts.createContact(ctx, {
      name: "Cliente Board",
      phone: `0981${Math.floor(Math.random() * 900000) + 100000}`,
    });
    contactId = contact!.id;
  });

  it("sums deal values per stage, keeping stages with no deals at zero", async () => {
    await deals.createDeal(ctx, {
      contactId,
      pipelineId,
      stageId: openStageId,
      title: "A",
      value: 300000,
    });
    await deals.createDeal(ctx, {
      contactId,
      pipelineId,
      stageId: openStageId,
      title: "B",
      value: 200000,
    });
    await deals.createDeal(ctx, {
      contactId,
      pipelineId,
      stageId: laterStageId,
      title: "C",
      value: 1000000,
    });

    const rows = await deals.listDealsForPipeline(ctx, pipelineId);
    const totals = deals.totalsByStage(rows);

    expect(totals.get(openStageId)).toBe(500000);
    expect(totals.get(laterStageId)).toBe(1000000);
    // A stage nothing was ever moved into has no entry — the board reads
    // that as 0 via `?? 0`, not as a thrown lookup.
    expect(totals.has("nonexistent-stage")).toBe(false);
  });

  it("updates the stale-after-days threshold on a stage, and clears it back to never-flag", async () => {
    await pipelines.updateStage(ctx, openStageId, { staleAfterDays: 3 });
    let stage = await pipelines.getStage(ctx, openStageId);
    expect(stage?.staleAfterDays).toBe(3);

    await pipelines.updateStage(ctx, openStageId, { staleAfterDays: null });
    stage = await pipelines.getStage(ctx, openStageId);
    expect(stage?.staleAfterDays).toBeNull();
  });
});
