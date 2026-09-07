import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The setup assistant end to end (PLAN.md §16.5, K2's exit criterion): a
// tenant with an empty memory goes from first login to an applied plan
// through the conversation, plan generation (mocked driver) and apply —
// the same three files (conversation.ts/plan.ts/apply.ts) wired together.
// Needs a real MySQL, like every other suite that writes through tenantDb.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("setup assistant (MySQL integration)", () => {
  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  let newId: (typeof import("@/lib/ids"))["newId"];

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("@/lib/ai");
  });

  afterAll(async () => {
    const { db } = await import("@/db/client");
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  async function freshTenant(): Promise<TenantContext> {
    if (!newId) ({ newId } = await import("@/lib/ids"));
    const { createTenant } = await import("@/modules/tenancy/tenants");
    const superadmin = { userId: "sa-setup", impersonatorUserId: null } as const;
    const slug = `setup-${newId().toLowerCase()}`;
    const tenant = await createTenant(superadmin, { name: `Setup ${newId()}`, slug });
    return {
      tenantId: tenant!.id,
      userId: "admin-user",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };
  }

  function mockDriver(data: Record<string, unknown>) {
    vi.doMock("@/lib/ai", () => ({
      getAiDriver: () => ({
        provider: "openai",
        model: "stub-model",
        generateReply: vi.fn(),
        generateStructured: vi.fn().mockResolvedValue({
          data,
          raw: JSON.stringify(data),
          model: "stub-model",
          promptTokens: 10,
          completionTokens: 20,
          attempts: 1,
        }),
        transcribeAudio: vi.fn(),
      }),
    }));
  }

  // Names deliberately distinct from `DEFAULT_STAGES` (pipelines.ts) — a
  // fresh tenant with no pipeline gets one seeded with those names before
  // this preset's own stages are added (applyStages), and a same-named
  // stage is skipped as already existing (idempotent by name). Colliding
  // here would undercount what this test means to check.
  const VALID_PLAN_OUTPUT = {
    stages: [
      { name: "Consulta" },
      { name: "Presupuesto enviado" },
      { name: "En conversación" },
      { name: "Cliente", isWon: true, staleAfterDays: 20 },
      { name: "No avanzó", isLost: true },
    ],
    tags: ["nuevo", "recurrente"],
    quickReplies: [
      { name: "Saludo", body: "¡Hola! Gracias por escribirnos." },
      { name: "Horario", body: "Atendemos de lunes a sábado." },
      { name: "Ubicación", body: "Estamos en el centro." },
    ],
    bookingTypes: [],
    welcomeMessage: "Gracias por tu mensaje, te respondemos apenas abramos.",
    reviewRequestMessage: "¡Gracias por confiar en nosotros! ¿Nos dejás una reseña?",
    closestVerticalSlug: "generico",
  };

  it("walks the whole conversation, resumes mid-way, and writes confirmed facts", async () => {
    const ctx = await freshTenant();
    const { submitSetupAnswer } = await import("./plan");
    const { SETUP_TOPICS } = await import("./conversation");

    let state = await submitSetupAnswer(ctx, {
      topic: "about",
      answer: "Somos una barbería para hombres en Asunción.",
    });
    expect(state.stepIndex).toBe(1);

    const { getProfile } = await import("@/modules/memory/profile");
    const profile = await getProfile(ctx);
    expect(profile?.about).toContain("barbería");

    // Resuming reads the saved step back rather than starting over.
    vi.resetModules();
    const { getDraftSetupPlan } = await import("./plan");
    const draft = await getDraftSetupPlan(ctx);
    expect((draft?.conversation as { stepIndex: number }).stepIndex).toBe(1);

    // Skip through to the FAQ topic and answer it with two questions.
    const { submitSetupAnswer: submit2 } = await import("./plan");
    for (const topic of SETUP_TOPICS.slice(1, 5)) {
      state = await submit2(ctx, { topic, skip: true });
    }
    expect(state.stepIndex).toBe(5);
    state = await submit2(ctx, {
      topic: "faqs",
      answer: "¿Hacen envíos?\nSí, a domicilio.\n\n¿Tienen garantía?\nSí, de 30 días.",
    });

    const { listFacts } = await import("@/modules/memory/facts");
    const faqs = await listFacts(ctx, { kind: "faq" });
    expect(faqs.map((f) => f.title)).toEqual(["¿Hacen envíos?", "¿Tienen garantía?"]);
    // Written by the conversation, not an AI suggestion — confirmed already.
    expect(faqs.every((f) => f.confirmedAt !== null)).toBe(true);

    // Finish the rest.
    for (const topic of SETUP_TOPICS.slice(6)) {
      state = await submit2(ctx, { topic, answer: "cercano y directo" });
    }
    expect(state.stepIndex).toBe(SETUP_TOPICS.length);
  });

  it("generates a plan with a mocked driver, previews it, and applies it exactly once", async () => {
    const ctx = await freshTenant();
    mockDriver(VALID_PLAN_OUTPUT);

    const { generateSetupPlan } = await import("./plan");
    const generated = await generateSetupPlan(ctx);
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;

    expect(generated.preset.pipelineStages).toHaveLength(5);
    expect(generated.preset.quickReplies).toHaveLength(3);
    expect(generated.preset.flows.map((f) => f.trigger)).toEqual(
      expect.arrayContaining(["wa_message_received", "deal_won"]),
    );

    const { applySetupPlan } = await import("./apply");
    const first = await applySetupPlan(ctx, generated.planId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.outcome.created.stages).toBe(5);
    expect(first.outcome.created.quickReplies).toBe(3);

    // Applying the same plan again is rejected, not a second set of stages —
    // `setup_plans.status` flips to `applied` on the first call.
    const second = await applySetupPlan(ctx, generated.planId);
    expect(second).toEqual({ ok: false, reason: "already_applied" });

    const { getProfile } = await import("@/modules/memory/profile");
    const profile = await getProfile(ctx);
    expect(profile?.verticalSlug).toBe("generico");
  });

  it("falls back cleanly when no AI driver is configured", async () => {
    vi.doMock("@/lib/ai", () => ({ getAiDriver: () => null }));
    const ctx = await freshTenant();
    const { generateSetupPlan } = await import("./plan");

    const result = await generateSetupPlan(ctx);
    expect(result).toEqual({ ok: false, reason: "ai_unavailable" });
  });
});
