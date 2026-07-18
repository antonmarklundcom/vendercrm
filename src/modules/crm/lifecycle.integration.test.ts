import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The 1C exit criterion, driven end-to-end through the real services:
// form submission → contact created → deal opened in a stage → deal moved
// across the kanban → the contact timeline reflects the whole history. Also
// asserts the internal event dispatcher fires along the way (PLAN.md §5).
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("CRM lead lifecycle", () => {
  let db: (typeof import("@/db/client"))["db"];
  let tenancy: typeof import("@/modules/tenancy/service");
  let crm: typeof import("./index");
  let forms: typeof import("@/modules/forms/service");
  let events: typeof import("@/lib/events");
  type TenantContext = import("@/modules/tenancy/types").TenantContext;

  let ctx: TenantContext;
  let slug: string;

  const uniq = () => Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    tenancy = await import("@/modules/tenancy/service");
    crm = await import("./index");
    forms = await import("@/modules/forms/service");
    events = await import("@/lib/events");

    slug = `life-${uniq()}`;
    const { tenantId, adminUserId } = await tenancy.createTenant({
      name: "Lifecycle Co",
      slug,
      adminEmail: `life-${uniq()}@x.com`,
      adminPassword: "password123",
      adminName: "Owner",
    });
    ctx = {
      tenantId,
      userId: adminUserId,
      role: "admin",
      isSuperadmin: false,
      impersonatorUserId: null,
    };
  });

  afterAll(async () => {
    events._resetHandlers();
    if (!db) return;
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  it("runs form → contact → deal → stage move → timeline", async () => {
    const pipeline = (await crm.getDefaultPipeline(ctx))!;
    const stages = await crm.listStages(ctx, pipeline.id);

    // A public lead form that drops submissions into the first stage.
    await forms.createForm(ctx, {
      name: "Contacto",
      slug: "contacto",
      fields: [
        { key: "name", label: "Nombre", type: "text", required: true },
        { key: "phone", label: "Teléfono", type: "phone", required: true },
      ],
      settings: {
        targetPipelineId: pipeline.id,
        targetStageId: stages[0].id,
      },
    });

    // Capture that form.submitted fires.
    const fired: string[] = [];
    events.on("form.submitted", (p) => {
      fired.push(p.contactId);
    });

    const result = await forms.submitPublicForm({
      tenantSlug: slug,
      formSlug: "contacto",
      data: { name: "Juan Pérez", phone: "0981 555 123" },
    });
    expect(result.ok).toBe(true);
    expect(fired.length).toBe(1);

    // Contact was created (phone normalized to E.164) and found by search.
    const contacts = await crm.listContacts(ctx, { search: "Juan" });
    expect(contacts.length).toBe(1);
    const contact = contacts[0];
    expect(contact.phone).toBe("+595981555123");

    // A deal was opened in the first stage.
    const deals = await crm.listDealsForContact(ctx, contact.id);
    expect(deals.length).toBe(1);
    const deal = deals[0];
    expect(deal.stageId).toBe(stages[0].id);

    // Move the deal to the "won" stage.
    const wonStage = stages.find((s) => s.isWon)!;
    await crm.moveDeal(ctx, deal.id, wonStage.id);
    const moved = await crm.getDeal(ctx, deal.id);
    expect(moved!.stageId).toBe(wonStage.id);
    expect(moved!.closedAt).not.toBeNull();

    // Timeline shows both the form submission and the stage change.
    const timeline = await crm.listContactActivities(ctx, contact.id);
    const types = timeline.map((a) => a.type);
    expect(types).toContain("form_submission");
    expect(types).toContain("stage_change");
  });
});
