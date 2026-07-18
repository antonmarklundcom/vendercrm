import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The 1F flagship scenario, driven end-to-end (PLAN.md §10 exit criteria):
// form submitted → template sent → wait-for-reply → timeout branch sends a
// follow-up OR a reply moves the deal stage and cancels the timeout. Also
// verifies the engine is fully DB-driven — nothing here relies on in-memory
// state, so "process restart mid-wait" is exercised by resuming purely from
// persisted rows via the real job queue.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("automation flagship scenario", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let tenancy: typeof import("@/modules/tenancy/service");
  let crm: typeof import("@/modules/crm");
  let forms: typeof import("@/modules/forms/service");
  let wa: typeof import("@/modules/whatsapp");
  let processing: typeof import("@/modules/whatsapp/processing");
  let automations: typeof import("./index");
  let flows: typeof import("./flows");
  let worker: typeof import("@/worker");
  let queue: typeof import("@/lib/queue");
  type TenantContext = import("@/modules/tenancy/types").TenantContext;

  let ctx: TenantContext;
  let pipelineId: string;
  let stage0: string; // initial stage
  let stage1: string; // "moved to" stage on reply
  let formSlug: string;
  let formId: string;
  let tenantSlug: string;
  let phoneNumberId: string;

  const uniq = () => Math.random().toString(36).slice(2, 8);

  async function buildAndPublishFlow(name: string, timeoutMinutes: number) {
    const flowId = await flows.createFlow(ctx, { name });
    const graph = {
      nodes: [
        {
          id: "trigger",
          kind: "trigger",
          type: "form_submitted",
          position: { x: 0, y: 0 },
          config: { formId },
        },
        {
          id: "welcome",
          kind: "action",
          type: "send_wa_template",
          position: { x: 0, y: 0 },
          config: { templateName: "bienvenida", templateLanguage: "es" },
        },
        {
          id: "wait",
          kind: "delay",
          type: "wait_for_reply",
          position: { x: 0, y: 0 },
          config: { timeoutMinutes },
        },
        {
          id: "followup",
          kind: "action",
          type: "send_wa_template",
          position: { x: 0, y: 0 },
          config: { templateName: "seguimiento", templateLanguage: "es" },
        },
        {
          id: "move_stage",
          kind: "action",
          type: "move_deal_stage",
          position: { x: 0, y: 0 },
          config: { stageId: stage1 },
        },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "welcome" },
        { id: "e2", source: "welcome", target: "wait" },
        { id: "e3", source: "wait", target: "followup", sourceHandle: "timeout" },
        { id: "e4", source: "wait", target: "move_stage", sourceHandle: "reply" },
      ],
    };
    const versionId = await flows.saveDraftVersion(ctx, flowId, graph);
    await flows.publishVersion(ctx, flowId, versionId);
    return flowId;
  }

  async function submitLeadForm(phoneSuffix: string) {
    const result = await forms.submitPublicForm({
      tenantSlug,
      formSlug,
      data: { name: `Lead ${phoneSuffix}`, phone: `+59598${phoneSuffix}` },
    });
    expect(result.ok).toBe(true);
  }

  // The jobs table is shared across the whole test run (not scoped per
  // test), and every contact/form/message event now enqueues a real job
  // (PLAN.md §5/§7.2 wiring) — so draining needs enough budget to clear
  // other tests' interleaved jobs too, not just this test's own.
  async function drainQueue(max = 200) {
    for (let i = 0; i < max; i++) {
      const did = await worker.tick("test");
      if (!did) break;
    }
  }

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    tenancy = await import("@/modules/tenancy/service");
    crm = await import("@/modules/crm");
    forms = await import("@/modules/forms/service");
    wa = await import("@/modules/whatsapp");
    processing = await import("@/modules/whatsapp/processing");
    automations = await import("./index");
    flows = await import("./flows");
    worker = await import("@/worker");
    queue = await import("@/lib/queue");
    await import("./jobs");
    await import("@/modules/whatsapp/jobs");

    const s = uniq();
    tenantSlug = `flagship-${s}`;
    const { tenantId } = await tenancy.createTenant({
      name: "Flagship Co",
      slug: tenantSlug,
      adminEmail: `flagship-${s}@x.com`,
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

    const pipeline = await crm.getDefaultPipeline(ctx);
    pipelineId = pipeline!.id;
    const stages = await crm.listStages(ctx, pipelineId);
    stage0 = stages[0].id;
    stage1 = stages[1].id;

    formSlug = `lead-${s}`;
    formId = await forms.createForm(ctx, {
      name: "Lead form",
      slug: formSlug,
      fields: [
        { key: "name", label: "Nombre", type: "text", required: true },
        { key: "phone", label: "Teléfono", type: "phone", required: true },
      ],
      settings: { targetPipelineId: pipelineId, targetStageId: stage0 },
    });

    phoneNumberId = `pn-${s}`;
    await wa.connectManual(ctx, {
      wabaId: `WABA-${s}`,
      phoneNumberId,
      accessToken: "tok",
    });

    // Every template send resolves successfully.
    wa.setGraphFetch(async () =>
      new Response(
        JSON.stringify({ messages: [{ id: `wamid.${Math.random()}` }] }),
        { status: 200 },
      ),
    );
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

  it("timeout path: no reply -> follow-up sent, run completes", async () => {
    const flowId = await buildAndPublishFlow(`Timeout-${uniq()}`, 60);
    const suffix = uniq();
    await submitLeadForm(suffix);
    await drainQueue(); // processes AUTOMATION_TRIGGER -> startRun -> welcome sent -> parks waiting

    const [contact] = (
      await crm.listContacts(ctx, { search: `Lead ${suffix}` })
    );
    expect(contact).toBeDefined();

    const runsBefore = await automations.listActiveRunsForContact(ctx, contact.id);
    const run = runsBefore.find((r) => r.flowId === flowId);
    expect(run).toBeDefined();
    expect(run!.status).toBe("waiting");
    expect(run!.waitFor).toBe("reply");
    expect(run!.currentNodeId).toBe("wait");

    // Confirm the durable resume job was actually persisted (not just
    // in-memory state) — this is what "survives a restart" means: nothing
    // about resuming this run depends on process memory, only these rows.
    const pendingJobs = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.type, "automation.resume"));
    const ourJob = pendingJobs.find(
      (j) => (j.payload as { runId?: string }).runId === run!.id,
    );
    expect(ourJob).toBeDefined();
    expect((ourJob!.payload as { kind?: string }).kind).toBe("timeout");

    // Simulate time passing (and a fresh process picking the job back up):
    // force the job due now, then let the worker claim and process it purely
    // from persisted state.
    await db
      .update(schema.jobs)
      .set({ runAt: new Date() })
      .where(eq(schema.jobs.id, ourJob!.id));
    await drainQueue();

    const [finished] = await db
      .select()
      .from(schema.flowRuns)
      .where(eq(schema.flowRuns.id, run!.id));
    expect(finished.status).toBe("completed");

    const steps = await db
      .select()
      .from(schema.flowRunSteps)
      .where(eq(schema.flowRunSteps.runId, run!.id));
    const resumeStep = steps.find(
      (s) => (s.result as { resumedVia?: string })?.resumedVia === "timeout",
    );
    expect(resumeStep).toBeDefined();
    const followupStep = steps.find((s) => s.nodeId === "followup" && s.status === "ok");
    expect(followupStep).toBeDefined();

    // The deal stayed in the original stage — no reply ever moved it.
    const deals = await crm.listDealsForContact(ctx, contact.id);
    expect(deals[0].stageId).toBe(stage0);
  });

  it("reply path: contact replies -> deal stage moves, timeout becomes a no-op", async () => {
    const flowId = await buildAndPublishFlow(`Reply-${uniq()}`, 60);
    const suffix = uniq();
    await submitLeadForm(suffix);
    await drainQueue();

    const [contact] = await crm.listContacts(ctx, { search: `Lead ${suffix}` });
    const runsBefore = await automations.listActiveRunsForContact(ctx, contact.id);
    const run = runsBefore.find((r) => r.flowId === flowId)!;
    expect(run.status).toBe("waiting");

    // Contact replies over WhatsApp — real webhook path, not a direct engine call.
    await processing.processWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: phoneNumberId },
                contacts: [{ profile: { name: `Lead ${suffix}` } }],
                messages: [
                  {
                    from: `59598${suffix}`,
                    id: `wamid.reply.${suffix}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: "Sí, me interesa" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    await drainQueue(); // wa.message_received -> AUTOMATION_INBOUND_REPLY -> resumeRun('reply')

    const [afterReply] = await db
      .select()
      .from(schema.flowRuns)
      .where(eq(schema.flowRuns.id, run.id));
    expect(afterReply.status).toBe("completed");

    const deals = await crm.listDealsForContact(ctx, contact.id);
    expect(deals[0].stageId).toBe(stage1); // moved by the "replied" branch

    // The timeout job is still sitting in the queue (scheduled well in the
    // future) — force it due now and prove it's a no-op: the compare-and-set
    // in resumeRun loses because status is no longer "waiting".
    const pendingJobs = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.type, "automation.resume"));
    const staleJob = pendingJobs.find(
      (j) => (j.payload as { runId?: string }).runId === run.id,
    );
    expect(staleJob).toBeDefined();
    await db.update(schema.jobs).set({ runAt: new Date() }).where(eq(schema.jobs.id, staleJob!.id));
    await drainQueue();

    const stepsAfter = await db
      .select()
      .from(schema.flowRunSteps)
      .where(eq(schema.flowRunSteps.runId, run.id));
    // No "followup" step was ever recorded — the timeout branch never ran.
    expect(stepsAfter.some((s) => s.nodeId === "followup")).toBe(false);

    void queue; // referenced import kept meaningful
    void pipelineId;
  });
});
