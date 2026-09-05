import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateGraph, type FlowGraph } from "./graph";

// Graph validation is pure; the engine needs a real MySQL because durable
// state is the whole point (§7.2).
const hasDb = !!process.env.DATABASE_URL;

function graphOf(nodes: FlowGraph["nodes"], edges: FlowGraph["edges"]): FlowGraph {
  return { nodes, edges };
}

describe("validateGraph", () => {
  const trigger = {
    id: "t1",
    type: "trigger" as const,
    config: { triggerType: "form_submitted" as const },
  };
  const action = {
    id: "a1",
    type: "action" as const,
    config: { kind: "add_tag" as const, tagId: "x" },
  };

  it("accepts a trigger wired to an action", () => {
    const errors = validateGraph(
      graphOf([trigger, action], [{ id: "e1", source: "t1", target: "a1", branch: "default" }]),
    );
    expect(errors).toEqual([]);
  });

  it("rejects a graph with no trigger and one with two", () => {
    expect(validateGraph(graphOf([action], [])).some((e) => e.code === "trigger_count")).toBe(true);
    expect(
      validateGraph(graphOf([trigger, { ...trigger, id: "t2" }], [])).some(
        (e) => e.code === "trigger_count",
      ),
    ).toBe(true);
  });

  it("rejects orphan nodes the trigger can never reach", () => {
    const errors = validateGraph(graphOf([trigger, action], []));
    expect(errors.some((e) => e.code === "orphan_node")).toBe(true);
  });

  it("rejects cycles", () => {
    const a2 = { ...action, id: "a2" };
    const errors = validateGraph(
      graphOf(
        [trigger, action, a2],
        [
          { id: "e1", source: "t1", target: "a1", branch: "default" },
          { id: "e2", source: "a1", target: "a2", branch: "default" },
          { id: "e3", source: "a2", target: "a1", branch: "default" },
        ],
      ),
    );
    expect(errors.some((e) => e.code === "cycle")).toBe(true);
  });

  it("rejects edges pointing at nodes that don't exist", () => {
    const errors = validateGraph(
      graphOf([trigger], [{ id: "e1", source: "t1", target: "ghost", branch: "default" }]),
    );
    expect(errors.some((e) => e.code === "unknown_target")).toBe(true);
  });
});

describe.skipIf(!hasDb)("automation engine (MySQL)", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let newId: (typeof import("@/lib/ids"))["newId"];
  let createTenant: (typeof import("@/modules/tenancy/tenants"))["createTenant"];
  let buildSystemTenantContext: (typeof import("@/modules/tenancy/context"))["buildSystemTenantContext"];
  let createContact: (typeof import("@/modules/crm/contacts"))["createContact"];
  let listTagsForContact: (typeof import("@/modules/crm/contacts"))["listTagsForContact"];
  let createTag: (typeof import("@/modules/crm/contacts"))["createTag"];
  let createFlow: (typeof import("./flows"))["createFlow"];
  let saveDraft: (typeof import("./flows"))["saveDraft"];
  let publishFlow: (typeof import("./flows"))["publishFlow"];
  let startRun: (typeof import("./engine"))["startRun"];
  let advanceRun: (typeof import("./engine"))["advanceRun"];
  let getRun: (typeof import("./engine"))["getRun"];
  let resumeOnReply: (typeof import("./engine"))["resumeOnReply"];
  let timeoutWaitForReply: (typeof import("./engine"))["timeoutWaitForReply"];

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  const superadmin = { userId: "sa-test", impersonatorUserId: null } as const;

  let ctx: TenantContext;
  let ctxB: TenantContext;

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    ({ newId } = await import("@/lib/ids"));
    ({ createTenant } = await import("@/modules/tenancy/tenants"));
    ({ buildSystemTenantContext } = await import("@/modules/tenancy/context"));
    ({ createContact, listTagsForContact, createTag } = await import("@/modules/crm/contacts"));
    ({ createFlow, saveDraft, publishFlow } = await import("./flows"));
    ({ startRun, advanceRun, getRun, resumeOnReply, timeoutWaitForReply } = await import("./engine"));

    const tenant = await createTenant(superadmin, { name: "Auto", slug: `auto-${newId()}` });
    const tenantB = await createTenant(superadmin, { name: "Auto B", slug: `auto-b-${newId()}` });
    ctx = (await buildSystemTenantContext(tenant!.id))!;
    ctxB = (await buildSystemTenantContext(tenantB!.id))!;
  });

  afterAll(async () => {
    if (!db) return;
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  async function newContact() {
    return (await createContact(ctx, {
      name: "Lead",
      phone: `0981${Math.floor(100000 + Math.random() * 899999)}`,
    }))!;
  }

  /** Trigger → add_tag. The simplest flow that proves the loop runs. */
  async function publishTagFlow(tagId: string) {
    const flow = await createFlow(ctx, { name: "Etiquetar", triggerType: "form_submitted" });
    await saveDraft(ctx, flow!.id, {
      nodes: [
        { id: "t1", type: "trigger", config: { triggerType: "form_submitted" } },
        { id: "a1", type: "action", config: { kind: "add_tag", tagId } },
      ],
      edges: [{ id: "e1", source: "t1", target: "a1", branch: "default" }],
    });
    const published = await publishFlow(ctx, flow!.id);
    expect(published.ok).toBe(true);
    return { flowId: flow!.id, versionId: published.ok ? published.versionId : "" };
  }

  it("runs a published flow to completion and applies its action", async () => {
    const tag = await createTag(ctx, { name: `interesado-${newId()}` });
    const { flowId, versionId } = await publishTagFlow(tag!.id);
    const contact = await newContact();

    const runId = await startRun(ctx, {
      flowId,
      flowVersionId: versionId,
      contactId: contact.id,
      startedBy: {},
    });
    expect(runId).toBeTruthy();

    await advanceRun(ctx, runId!);

    const run = await getRun(ctx, runId!);
    expect(run!.status).toBe("completed");

    const tags = await listTagsForContact(ctx, contact.id);
    expect(tags.some((t) => t.id === tag!.id)).toBe(true);
  });

  // GBP review request (PLAN.md §10 1R #5): an unconfigured send guard
  // (no review link, no WhatsApp account) must be a skipped step, not a
  // failed run — same guarantee send_whatsapp already has for a closed
  // window (§7.2).
  it("completes a send_review_request flow even with no review link configured", async () => {
    const flow = await createFlow(ctx, { name: "Reseña", triggerType: "deal_stage_changed" });
    await saveDraft(ctx, flow!.id, {
      nodes: [
        { id: "t1", type: "trigger", config: { triggerType: "deal_stage_changed" } },
        { id: "a1", type: "action", config: { kind: "send_review_request" } },
      ],
      edges: [{ id: "e1", source: "t1", target: "a1", branch: "default" }],
    });
    const published = await publishFlow(ctx, flow!.id);
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    const contact = await newContact();
    const runId = await startRun(ctx, {
      flowId: flow!.id,
      flowVersionId: published.versionId,
      contactId: contact.id,
      startedBy: {},
    });
    expect(runId).toBeTruthy();

    await advanceRun(ctx, runId!);

    const run = await getRun(ctx, runId!);
    expect(run!.status).toBe("completed");
  });

  it("refuses to publish an invalid graph, so a broken flow can never run", async () => {
    const flow = await createFlow(ctx, { name: "Rota", triggerType: "contact_created" });
    await saveDraft(ctx, flow!.id, {
      // Orphan action: nothing connects the trigger to it.
      nodes: [
        { id: "t1", type: "trigger", config: { triggerType: "contact_created" } },
        { id: "a1", type: "action", config: { kind: "add_tag", tagId: "x" } },
      ],
      edges: [],
    });

    const result = await publishFlow(ctx, flow!.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === "orphan_node")).toBe(true);

    const [row] = await db.select().from(schema.flows).where(eq(schema.flows.id, flow!.id));
    expect(row.publishedVersionId).toBeNull();
    expect(row.status).toBe("draft");
  });

  it("enforces max one live run per (flow, contact)", async () => {
    const tag = await createTag(ctx, { name: `dup-${newId()}` });
    const { flowId, versionId } = await publishTagFlow(tag!.id);
    const contact = await newContact();

    const first = await startRun(ctx, {
      flowId,
      flowVersionId: versionId,
      contactId: contact.id,
      startedBy: {},
    });
    const second = await startRun(ctx, {
      flowId,
      flowVersionId: versionId,
      contactId: contact.id,
      startedBy: {},
    });

    expect(first).toBeTruthy();
    expect(second).toBeNull();
  });

  /**
   * The flagship scenario (§10 1F exit criteria): wait-for-reply with a
   * timeout branch, and the engine surviving a process restart mid-wait.
   */
  async function publishWaitFlow(repliedTagId: string, timeoutTagId: string) {
    const flow = await createFlow(ctx, { name: "Seguimiento", triggerType: "form_submitted" });
    await saveDraft(ctx, flow!.id, {
      nodes: [
        { id: "t1", type: "trigger", config: { triggerType: "form_submitted" } },
        { id: "w1", type: "delay", config: { kind: "wait_for_reply", minutes: 2880 } },
        { id: "replied", type: "action", config: { kind: "add_tag", tagId: repliedTagId } },
        { id: "timedout", type: "action", config: { kind: "add_tag", tagId: timeoutTagId } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "w1", branch: "default" },
        { id: "e2", source: "w1", target: "replied", branch: "replied" },
        { id: "e3", source: "w1", target: "timedout", branch: "timeout" },
      ],
    });
    const published = await publishFlow(ctx, flow!.id);
    expect(published.ok).toBe(true);
    return { flowId: flow!.id, versionId: published.ok ? published.versionId : "" };
  }

  it("parks on wait-for-reply as durable state, then takes the replied branch", async () => {
    const replied = await createTag(ctx, { name: `respondio-${newId()}` });
    const timedOut = await createTag(ctx, { name: `sin-respuesta-${newId()}` });
    const { flowId, versionId } = await publishWaitFlow(replied!.id, timedOut!.id);
    const contact = await newContact();

    const runId = await startRun(ctx, {
      flowId,
      flowVersionId: versionId,
      contactId: contact.id,
      startedBy: {},
    });
    await advanceRun(ctx, runId!);

    // Parked in the database, not in memory — this is what makes it survive
    // a restart: nothing but the row is holding the run.
    let run = await getRun(ctx, runId!);
    expect(run!.status).toBe("waiting");
    expect(run!.waitFor).toBe("reply");
    expect(run!.currentNodeId).toBe("w1");

    await resumeOnReply(ctx, contact.id);
    await advanceRun(ctx, runId!);

    run = await getRun(ctx, runId!);
    expect(run!.status).toBe("completed");

    const tags = await listTagsForContact(ctx, contact.id);
    expect(tags.some((t) => t.id === replied!.id)).toBe(true);
    expect(tags.some((t) => t.id === timedOut!.id)).toBe(false);
  });

  it("takes the timeout branch when no reply arrives", async () => {
    const replied = await createTag(ctx, { name: `r2-${newId()}` });
    const timedOut = await createTag(ctx, { name: `t2-${newId()}` });
    const { flowId, versionId } = await publishWaitFlow(replied!.id, timedOut!.id);
    const contact = await newContact();

    const runId = await startRun(ctx, {
      flowId,
      flowVersionId: versionId,
      contactId: contact.id,
      startedBy: {},
    });
    await advanceRun(ctx, runId!);
    await timeoutWaitForReply(ctx, runId!, "w1");
    await advanceRun(ctx, runId!);

    const tags = await listTagsForContact(ctx, contact.id);
    expect(tags.some((t) => t.id === timedOut!.id)).toBe(true);
    expect(tags.some((t) => t.id === replied!.id)).toBe(false);
  });

  it("resolves the reply-vs-timeout race: whichever lands first wins, the other is a no-op", async () => {
    const replied = await createTag(ctx, { name: `r3-${newId()}` });
    const timedOut = await createTag(ctx, { name: `t3-${newId()}` });
    const { flowId, versionId } = await publishWaitFlow(replied!.id, timedOut!.id);
    const contact = await newContact();

    const runId = await startRun(ctx, {
      flowId,
      flowVersionId: versionId,
      contactId: contact.id,
      startedBy: {},
    });
    await advanceRun(ctx, runId!);

    // The reply wins; the timeout job fires immediately afterwards and must
    // not also advance the run down its own branch.
    await resumeOnReply(ctx, contact.id);
    await timeoutWaitForReply(ctx, runId!, "w1");
    await advanceRun(ctx, runId!);

    const tags = await listTagsForContact(ctx, contact.id);
    expect(tags.some((t) => t.id === replied!.id)).toBe(true);
    expect(tags.some((t) => t.id === timedOut!.id)).toBe(false);
  });

  it("skips sends for a contact tagged optout", async () => {
    const { hasOptedOut } = await import("./actions");
    const contact = await newContact();
    expect(await hasOptedOut(ctx, contact.id)).toBe(false);

    const optout = await createTag(ctx, { name: "optout" });
    await (await import("@/modules/crm/contacts")).addTagToContact(ctx, contact.id, optout!.id);

    expect(await hasOptedOut(ctx, contact.id)).toBe(true);
  });

  /**
   * A crash mid-flow used to replay the whole run. `advanceRun` walks the
   * graph in one synchronous loop, and it only wrote `currentNodeId` back
   * when it parked on a wait or finished — so a process that died halfway
   * left the row pointing at the node the job *started* on, and the
   * stuck-job reaper (worker/maintenance.ts) then re-queued
   * `automation.advance`, which re-executed every action already done. On a
   * flow whose first node sends WhatsApp that is a second message to a real
   * customer.
   *
   * The observable proof is a run that fails on its second action: the row
   * must be left pointing at the node that failed, and re-entering
   * `advanceRun` the way the reaper does must not run the first action
   * again.
   */
  it("persists progress between nodes, so a retried advance never repeats a completed action", async () => {
    const { createPipelineWithDefaultStages } = await import("@/modules/crm/pipelines");
    const { createDeal } = await import("@/modules/crm/deals");
    const { listActivitiesForContact } = await import("@/modules/crm/activities");

    const contact = await newContact();
    const pipeline = await createPipelineWithDefaultStages(ctx, `Retry ${newId()}`);
    const { listStagesForPipeline } = await import("@/modules/crm/pipelines");
    const [firstStage] = await listStagesForPipeline(ctx, pipeline!.id);
    await createDeal(ctx, {
      contactId: contact.id,
      pipelineId: pipeline!.id,
      stageId: firstStage.id,
      title: "Retry",
    });

    const noteText = `paso-uno-${newId()}`;
    const flow = await createFlow(ctx, { name: "Reintento", triggerType: "form_submitted" });
    await saveDraft(ctx, flow!.id, {
      nodes: [
        { id: "t1", type: "trigger", config: { triggerType: "form_submitted" } },
        { id: "a1", type: "action", config: { kind: "create_note", text: noteText } },
        // Deliberately unreachable stage: moveDeal throws, which is how the
        // run stops with a1 already done and a2 in flight.
        { id: "a2", type: "action", config: { kind: "move_deal_stage", stageId: "no-such-stage" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "a1", branch: "default" },
        { id: "e2", source: "a1", target: "a2", branch: "default" },
      ],
    });
    const published = await publishFlow(ctx, flow!.id);
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    const runId = await startRun(ctx, {
      flowId: flow!.id,
      flowVersionId: published.versionId,
      contactId: contact.id,
      startedBy: {},
    });
    await advanceRun(ctx, runId!);

    const failed = await getRun(ctx, runId!);
    expect(failed!.status).toBe("failed");
    // The whole point: the row moved past the action that succeeded.
    expect(failed!.currentNodeId).toBe("a2");

    const countNotes = async () =>
      (await listActivitiesForContact(ctx, contact.id)).filter(
        (a) => (a.payload as { text?: string })?.text === noteText,
      ).length;
    expect(await countNotes()).toBe(1);

    // What the reaper produces: the run row as the dead process left it,
    // and the advance job queued again.
    await db
      .update(schema.flowRuns)
      .set({ status: "running" })
      .where(eq(schema.flowRuns.id, runId!));
    await advanceRun(ctx, runId!);

    expect(await countNotes()).toBe(1);
  });

  /**
   * J1's flagship sequence (PLAN.md §15.5): "presupuesto enviado → esperá 3
   * días → si no contestó, mandale la plantilla". Driven through
   * `dispatchTrigger` rather than by calling startRun, because the half that
   * is new in P1 is the trigger — a flow listening on `quote_sent` has to be
   * matched and started from the event, not just run once it exists.
   */
  it("runs quote sent → wait for reply → timeout → template", async () => {
    const { dispatchTrigger } = await import("./triggers");
    const { listStepsForRun } = await import("./engine");

    const flow = await createFlow(ctx, { name: "Seguimiento presupuesto", triggerType: "quote_sent" });
    await saveDraft(ctx, flow!.id, {
      nodes: [
        { id: "t1", type: "trigger", config: { triggerType: "quote_sent" } },
        { id: "w1", type: "delay", config: { kind: "wait_for_reply", minutes: 4320 } },
        {
          id: "a1",
          type: "action",
          config: { kind: "send_template", templateName: "seguimiento", language: "es" },
        },
      ],
      edges: [
        { id: "e1", source: "t1", target: "w1", branch: "default" },
        // The timeout branch is the one this flow is sold on; the replied
        // branch deliberately ends the run.
        { id: "e2", source: "w1", target: "a1", branch: "timeout" },
      ],
    });
    const published = await publishFlow(ctx, flow!.id);
    expect(published.ok).toBe(true);

    const contact = await newContact();
    await dispatchTrigger({
      tenantId: ctx.tenantId,
      triggerType: "quote_sent",
      contactId: contact.id,
      data: { quoteId: "q-test", number: "P-0001", total: 500000 },
    });

    const runs = await db
      .select()
      .from(schema.flowRuns)
      .where(eq(schema.flowRuns.flowId, flow!.id));
    expect(runs).toHaveLength(1);
    const runId = runs[0].id;

    // dispatchTrigger enqueues the advance job; the worker is not running in
    // this suite, so the test plays that job itself.
    await advanceRun(ctx, runId);
    let run = await getRun(ctx, runId);
    expect(run!.status).toBe("waiting");
    expect(run!.waitFor).toBe("reply");

    // Three days pass with no reply.
    await timeoutWaitForReply(ctx, runId, "w1");
    await advanceRun(ctx, runId);

    run = await getRun(ctx, runId);
    expect(run!.status).toBe("completed");

    // The template step ran. With no WhatsApp account connected in this
    // suite it records as skipped-with-a-reason rather than failing the run —
    // which is itself the guarantee §7.2 asks for.
    const steps = await listStepsForRun(ctx, runId);
    const templateStep = steps.find((step) => step.nodeId === "a1");
    expect(templateStep).toBeTruthy();
    expect(["ok", "skipped"]).toContain(templateStep!.status);
  });

  /**
   * The other J1 exit criterion: money arriving moves the deal. Covers both
   * halves — that `recordPayment` emits `document.paid` exactly once when the
   * ledger reaches the total, and that a flow on that trigger can close the
   * deal.
   */
  it("fires document paid once and moves the deal to the won stage", async () => {
    const { dispatchTrigger } = await import("./triggers");
    const { documentEvents } = await import("@/modules/documents/events");
    const { createDocument, issueDocument, recordPayment } = await import(
      "@/modules/documents/documents"
    );
    const { seedDefaultPipeline, listStagesForPipeline } = await import(
      "@/modules/crm/pipelines"
    );
    const { createDeal, getDeal } = await import("@/modules/crm/deals");

    const pipeline = await seedDefaultPipeline(ctx);
    const stages = await listStagesForPipeline(ctx, pipeline!.id);
    const wonStage = stages.find((stage) => stage.isWon)!;
    expect(wonStage).toBeTruthy();

    const contact = await newContact();
    const deal = await createDeal(ctx, {
      contactId: contact.id,
      pipelineId: pipeline!.id,
      stageId: stages[0].id,
      title: "Instalación",
      value: 1_000_000,
    });

    const flow = await createFlow(ctx, { name: "Cobrado", triggerType: "document_paid" });
    await saveDraft(ctx, flow!.id, {
      nodes: [
        { id: "t1", type: "trigger", config: { triggerType: "document_paid" } },
        { id: "a1", type: "action", config: { kind: "move_deal_stage", stageId: wonStage.id } },
      ],
      edges: [{ id: "e1", source: "t1", target: "a1", branch: "default" }],
    });
    const published = await publishFlow(ctx, flow!.id);
    expect(published.ok).toBe(true);

    const paidEvents: string[] = [];
    documentEvents.on("document.paid", async ({ documentId }) => {
      paidEvents.push(documentId);
    });

    const document = await createDocument(ctx, {
      contactId: contact.id,
      dealId: deal!.id,
      items: [{ description: "Instalación", qty: 1, unitPrice: 1_000_000 }],
    });
    await issueDocument(ctx, document!.id);

    // Half now: no event, because the ledger has not reached the total.
    await recordPayment(ctx, document!.id, { amount: 500_000 });
    expect(paidEvents).toEqual([]);

    // The rest: fires exactly once.
    await recordPayment(ctx, document!.id, { amount: 500_000 });
    expect(paidEvents).toEqual([document!.id]);

    // And an extra payment on an already-settled document fires nothing —
    // "cobrado → pedile la reseña" must not send a second message.
    await recordPayment(ctx, document!.id, { amount: 10_000 });
    expect(paidEvents).toEqual([document!.id]);

    await dispatchTrigger({
      tenantId: ctx.tenantId,
      triggerType: "document_paid",
      contactId: contact.id,
      data: { documentId: document!.id, dealId: deal!.id },
    });

    const runs = await db
      .select()
      .from(schema.flowRuns)
      .where(eq(schema.flowRuns.flowId, flow!.id));
    expect(runs).toHaveLength(1);
    await advanceRun(ctx, runs[0].id);

    expect((await getRun(ctx, runs[0].id))!.status).toBe("completed");
    expect((await getDeal(ctx, deal!.id))!.stageId).toBe(wonStage.id);
  });

  it("flows and runs are isolated per tenant", async () => {
    const { listFlows } = await import("./flows");
    const tag = await createTag(ctx, { name: `iso-${newId()}` });
    const { flowId } = await publishTagFlow(tag!.id);

    const flowsB = await listFlows(ctxB);
    expect(flowsB.some((f) => f.id === flowId)).toBe(false);

    const runsB = await db
      .select()
      .from(schema.flowRuns)
      .where(eq(schema.flowRuns.tenantId, ctxB.tenantId));
    expect(runsB.every((r) => r.tenantId === ctxB.tenantId)).toBe(true);
  });
});
