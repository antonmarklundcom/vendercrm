import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The H8 exit criterion that isn't a UI gesture: a deal can be won or lost
// and leaves the active columns. Real MySQL, same pattern as the other
// integration suites.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("closing deals and configuring stages (MySQL integration)", () => {
  let newId: (typeof import("@/lib/ids"))["newId"];
  let deals: typeof import("./deals");
  let pipelines: typeof import("./pipelines");
  let contacts: typeof import("./contacts");
  let search: typeof import("./search");
  let createTenant: (typeof import("@/modules/tenancy/tenants"))["createTenant"];

  type TenantContext = import("@/modules/tenancy/context").TenantContext;

  let ctx: TenantContext;
  let otherCtx: TenantContext;
  let pipelineId: string;
  let contactId: string;

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    deals = await import("./deals");
    pipelines = await import("./pipelines");
    contacts = await import("./contacts");
    search = await import("./search");
    ({ createTenant } = await import("@/modules/tenancy/tenants"));

    const superadmin = { userId: "sa-h8", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, {
      name: `Deals ${newId()}`,
      slug: `dl-${newId()}`,
    });
    const other = await createTenant(superadmin, {
      name: `Other ${newId()}`,
      slug: `ot8-${newId()}`,
    });

    ctx = {
      tenantId: tenant!.id,
      userId: "system",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };
    otherCtx = { ...ctx, tenantId: other!.id };

    const pipeline = await pipelines.createPipelineWithDefaultStages(ctx, "Ventas");
    pipelineId = pipeline!.id;

    const contact = await contacts.createContact(ctx, {
      name: "Cliente Cerrado",
      phone: `0981${Math.floor(Math.random() * 900000) + 100000}`,
    });
    contactId = contact!.id;
  });

  async function newDeal(title: string) {
    const stages = await pipelines.listStagesForPipeline(ctx, pipelineId);
    const first = stages.find((stage) => !stage.isWon && !stage.isLost)!;
    return deals.createDeal(ctx, {
      contactId,
      pipelineId,
      stageId: first.id,
      title,
      value: 500000,
    });
  }

  it("marks a deal won, into the pipeline's won stage, with its reason", async () => {
    const deal = await newDeal("Ganada");
    const closed = await deals.closeDeal(ctx, deal!.id, "won", "precio aceptado");

    const stage = await pipelines.getStage(ctx, closed!.stageId);
    expect(stage?.isWon).toBe(true);
    expect(closed!.closedAt).not.toBeNull();
    expect(closed!.closeReason).toBe("precio aceptado");

    // "Disappears from active columns" is exactly this: the deal is no
    // longer in any stage the board shows by default.
    const stages = await pipelines.listStagesForPipeline(ctx, pipelineId);
    const openStageIds = new Set(
      stages.filter((s) => !s.isWon && !s.isLost).map((s) => s.id),
    );
    expect(openStageIds.has(closed!.stageId)).toBe(false);
  });

  it("marks a deal lost, and reopening puts it back on the board", async () => {
    const deal = await newDeal("Perdida");
    const lost = await deals.closeDeal(ctx, deal!.id, "lost", "eligió a otro");
    expect((await pipelines.getStage(ctx, lost!.stageId))?.isLost).toBe(true);
    // Lost writes lostReason, not closeReason — the two answer different
    // questions (§15.8 P5).
    expect(lost!.lostReason).toBe("eligió a otro");
    expect(lost!.closeReason).toBeNull();

    const stages = await pipelines.listStagesForPipeline(ctx, pipelineId);
    const open = stages.find((stage) => !stage.isWon && !stage.isLost)!;
    const reopened = await deals.reopenDeal(ctx, deal!.id, open.id);

    expect(reopened!.stageId).toBe(open.id);
    expect(reopened!.closedAt).toBeNull();
    expect(reopened!.closeReason).toBeNull();
    expect(reopened!.lostReason).toBeNull();
  });

  it("refuses to close when the pipeline has no won/lost stage", async () => {
    const bare = await pipelines.createPipeline(ctx, { name: "Sin cierre" });
    const stage = await pipelines.createStage(ctx, {
      pipelineId: bare!.id,
      name: "Única",
      position: 0,
    });
    const deal = await deals.createDeal(ctx, {
      contactId,
      pipelineId: bare!.id,
      stageId: stage!.id,
      title: "Sin salida",
    });

    await expect(deals.closeDeal(ctx, deal!.id, "won")).rejects.toThrow("noStage");
  });

  it("deletes an empty stage but refuses one holding deals", async () => {
    const stage = await pipelines.createStage(ctx, {
      pipelineId,
      name: "Vacía",
      position: 99,
    });
    await pipelines.deleteStageIfEmpty(ctx, stage!.id);
    expect(await pipelines.getStage(ctx, stage!.id)).toBeNull();

    const stages = await pipelines.listStagesForPipeline(ctx, pipelineId);
    const held = stages.find((s) => !s.isWon && !s.isLost)!;
    await deals.createDeal(ctx, { contactId, pipelineId, stageId: held.id, title: "Ocupa" });
    await expect(pipelines.deleteStageIfEmpty(ctx, held.id)).rejects.toThrow("notEmpty");
  });

  it("keeps won and lost mutually exclusive", async () => {
    const stage = await pipelines.createStage(ctx, {
      pipelineId,
      name: "Ambigua",
      position: 98,
      isWon: true,
    });
    const updated = await pipelines.updateStage(ctx, stage!.id, { isLost: true });
    expect(updated?.isLost).toBe(true);
    expect(updated?.isWon).toBe(false);
  });

  it("searches contacts and deals, and never crosses tenants", async () => {
    const mine = await search.searchTenant(ctx, "Cliente Cerrado");
    expect(mine.hits.some((hit) => hit.kind === "contact")).toBe(true);

    const theirs = await search.searchTenant(otherCtx, "Cliente Cerrado");
    expect(theirs.hits).toEqual([]);

    const byDeal = await search.searchTenant(ctx, "Ganada");
    expect(byDeal.hits.some((hit) => hit.kind === "deal" && hit.href.startsWith("/pipeline/"))).toBe(
      true,
    );

    // Two characters is the floor; one returns nothing rather than the
    // whole tenant.
    expect((await search.searchTenant(ctx, "a")).hits).toEqual([]);
  });
});
