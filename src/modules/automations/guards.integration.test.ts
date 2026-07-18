import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Guard tests for PLAN.md §7.2: max one active run per (flow, contact),
// max-100-steps cycle safety net, "stop on reply" cancelling other active
// runs, and the global opt-out tag skipping send actions.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("automation guards", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let tenancy: typeof import("@/modules/tenancy/service");
  let crm: typeof import("@/modules/crm");
  let wa: typeof import("@/modules/whatsapp");
  let automations: typeof import("./index");
  let flows: typeof import("./flows");
  let inbound: typeof import("./inbound");
  let optout: typeof import("./optout");
  type TenantContext = import("@/modules/tenancy/types").TenantContext;

  let ctx: TenantContext;
  const uniq = () => Math.random().toString(36).slice(2, 8);

  function linearGraph(trigger: unknown, actionType: string, actionConfig: unknown) {
    return {
      nodes: [
        trigger,
        { id: "a1", kind: "action", type: actionType, position: { x: 0, y: 0 }, config: actionConfig },
      ],
      edges: [{ id: "e1", source: (trigger as { id: string }).id, target: "a1" }],
    };
  }

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    tenancy = await import("@/modules/tenancy/service");
    crm = await import("@/modules/crm");
    wa = await import("@/modules/whatsapp");
    automations = await import("./index");
    flows = await import("./flows");
    inbound = await import("./inbound");
    optout = await import("./optout");
    await import("./jobs");

    const s = uniq();
    const { tenantId } = await tenancy.createTenant({
      name: "Guards Co",
      slug: `guards-${s}`,
      adminEmail: `guards-${s}@x.com`,
      adminPassword: "password123",
      adminName: "Owner",
    });
    ctx = {
      tenantId,
      userId: "u",
      role: "admin",
      isSuperadmin: false,
      impersonatorUserId: null,
    };
  });

  afterAll(async () => {
    wa.resetGraphFetch();
    if (!db) return;
    // Deliberately NOT closing the pool here: db/client.ts is a
    // module-level singleton, and depending on vitest's isolation/pool
    // settings it can be shared across test files run in the same
    // process — closing it here raced with other files still using it
    // (their queries would see a closed pool). The process exits when
    // the whole suite finishes, which reclaims the connection anyway.
  });

  it("at most one active run per (flow, contact)", async () => {
    const contactId = await crm.createContact(ctx, { name: `Guard ${uniq()}` });
    const flowId = await flows.createFlow(ctx, { name: `Cap-${uniq()}` });
    // Parks on a long delay so the first run is still "waiting" (active)
    // when the second trigger fires — that's what the guard actually gates.
    const graph = {
      nodes: [
        { id: "t", kind: "trigger", type: "contact_created", position: { x: 0, y: 0 }, config: {} },
        { id: "wait", kind: "delay", type: "wait_duration", position: { x: 0, y: 0 }, config: { durationMinutes: 999 } },
      ],
      edges: [{ id: "e1", source: "t", target: "wait" }],
    };
    const versionId = await flows.saveDraftVersion(ctx, flowId, graph);
    await flows.publishVersion(ctx, flowId, versionId);

    // Fire the trigger twice in a row for the same contact.
    await automations.triggerFlows(ctx, "contact_created", {
      contactId,
      payload: {},
      matchFields: {},
    });
    await automations.triggerFlows(ctx, "contact_created", {
      contactId,
      payload: {},
      matchFields: {},
    });

    const runs = await db
      .select()
      .from(schema.flowRuns)
      .where(eq(schema.flowRuns.flowId, flowId));
    // The first run is still "waiting" (active) when the second trigger
    // fires, so the guard must block the second run from being created.
    const forContact = runs.filter((r) => r.contactId === contactId);
    expect(forContact.length).toBe(1);
    expect(forContact[0].status).toBe("waiting");
  });

  it("max steps safety net fails a run that would exceed the cap", async () => {
    const contactId = await crm.createContact(ctx, { name: `MaxSteps ${uniq()}` });
    const flowId = await flows.createFlow(ctx, { name: `Cycle-${uniq()}` });

    // 101 chained no-op actions — no cycle (cycle detection would reject a
    // true loop), just a long chain that exceeds MAX_STEPS.
    const nodes: unknown[] = [
      { id: "t", kind: "trigger", type: "contact_created", position: { x: 0, y: 0 }, config: {} },
    ];
    const edges: unknown[] = [];
    let prev = "t";
    for (let i = 0; i < 101; i++) {
      const id = `a${i}`;
      nodes.push({
        id,
        kind: "action",
        type: "create_activity",
        position: { x: 0, y: 0 },
        config: { body: `step ${i}` },
      });
      edges.push({ id: `e${i}`, source: prev, target: id });
      prev = id;
    }
    const versionId = await flows.saveDraftVersion(ctx, flowId, { nodes, edges });
    await flows.publishVersion(ctx, flowId, versionId);

    await automations.triggerFlows(ctx, "contact_created", {
      contactId,
      payload: {},
      matchFields: {},
    });

    const [run] = await db
      .select()
      .from(schema.flowRuns)
      .where(eq(schema.flowRuns.flowId, flowId));
    expect(run.status).toBe("failed");
    expect(run.stepCount).toBeLessThanOrEqual(100);
  });

  it("stop-on-reply cancels an active run when the contact replies", async () => {
    const contactId = await crm.createContact(ctx, { name: `StopReply ${uniq()}` });
    const flowId = await flows.createFlow(ctx, { name: `Stop-${uniq()}` });
    // A run parked on a plain delay (not wait_for_reply) — a reply should
    // cancel it outright since stopOnReply defaults to true.
    const graph = {
      nodes: [
        { id: "t", kind: "trigger", type: "contact_created", position: { x: 0, y: 0 }, config: {} },
        { id: "wait", kind: "delay", type: "wait_duration", position: { x: 0, y: 0 }, config: { durationMinutes: 999 } },
      ],
      edges: [{ id: "e1", source: "t", target: "wait" }],
    };
    const versionId = await flows.saveDraftVersion(ctx, flowId, graph);
    await flows.publishVersion(ctx, flowId, versionId);

    await automations.triggerFlows(ctx, "contact_created", {
      contactId,
      payload: {},
      matchFields: {},
    });

    const [beforeReply] = await db
      .select()
      .from(schema.flowRuns)
      .where(eq(schema.flowRuns.flowId, flowId));
    expect(beforeReply.status).toBe("waiting");
    expect(beforeReply.waitFor).toBe("delay");

    await inbound.handleInboundReply(ctx, contactId, "cualquier respuesta");

    const [afterReply] = await db
      .select()
      .from(schema.flowRuns)
      .where(eq(schema.flowRuns.id, beforeReply.id));
    expect(afterReply.status).toBe("cancelled");
  });

  it("opt-out: BAJA auto-tags the contact and skips send actions", async () => {
    const contactId = await crm.createContact(ctx, {
      name: `Optout ${uniq()}`,
      phone: `+59598${uniq()}`,
    });

    await inbound.handleInboundReply(ctx, contactId, "BAJA");
    expect(await optout.isContactOptedOut(ctx, contactId)).toBe(true);

    // A flow with a send action for this now-opted-out contact should skip
    // the send, not fail or throw.
    const flowId = await flows.createFlow(ctx, { name: `Send-${uniq()}` });
    const graph = linearGraph(
      { id: "t", kind: "trigger", type: "tag_added", position: { x: 0, y: 0 }, config: {} },
      "send_wa_message",
      { body: "should be skipped" },
    );
    const versionId = await flows.saveDraftVersion(ctx, flowId, graph);
    await flows.publishVersion(ctx, flowId, versionId);

    await automations.triggerFlows(ctx, "tag_added", {
      contactId,
      payload: {},
      matchFields: {},
    });

    const [run] = await db
      .select()
      .from(schema.flowRuns)
      .where(eq(schema.flowRuns.flowId, flowId));
    expect(run.status).toBe("completed");

    const steps = await db
      .select()
      .from(schema.flowRunSteps)
      .where(eq(schema.flowRunSteps.runId, run.id));
    expect(steps[0].status).toBe("skipped");
  });
});
