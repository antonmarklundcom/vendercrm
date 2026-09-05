import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The memory as the reply path actually reads it (PLAN.md §16, K1 exit
// criterion): a customer asking "¿cuánto cuesta X?" must get the confirmed
// service fact, and must never get the internal note sitting next to it.
//
// An integration test rather than a unit test because the two guarantees
// under examination are WHERE clauses — internal facts and unconfirmed AI
// suggestions are excluded by the query, not by the prompt (§16.2 rules 2
// and 5) — and a stubbed repository would test the stub. It needs MySQL 8
// for the FULLTEXT index, so it skips without DATABASE_URL, like every other
// DB-backed suite here.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("business memory retrieval (MySQL integration)", () => {
  type TenantContext = import("@/modules/tenancy/context").TenantContext;

  let newId: (typeof import("@/lib/ids"))["newId"];
  let memory: typeof import("./retrieve");
  let facts: typeof import("./facts");
  let profile: typeof import("./profile");
  let buildSystemPrompt: (typeof import("@/lib/ai/prompt"))["buildSystemPrompt"];

  let ctx: TenantContext;
  let otherCtx: TenantContext;

  async function freshTenant(label: string): Promise<TenantContext> {
    const { createTenant } = await import("@/modules/tenancy/tenants");
    const superadmin = { userId: "sa-memory", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, {
      name: `Memoria ${label}`,
      slug: `memoria-${label}-${newId().toLowerCase()}`,
    });
    return {
      tenantId: tenant!.id,
      userId: "admin-memoria",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };
  }

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    memory = await import("./retrieve");
    facts = await import("./facts");
    profile = await import("./profile");
    ({ buildSystemPrompt } = await import("@/lib/ai/prompt"));

    ctx = await freshTenant("a");
    otherCtx = await freshTenant("b");

    await profile.upsertProfile(ctx, {
      displayName: "Clínica Sonrisa",
      legalName: null,
      ruc: null,
      about: "Odontología general y estética en Asunción",
      tone: "cercano",
      toneNote: null,
      audience: null,
      differentiators: null,
      website: null,
      address: "Av. España 123",
      mapsUrl: null,
      neverPromise: "plazos del laboratorio",
      paymentMethods: ["efectivo", "transferencia"],
    });

    await facts.createFact(ctx, {
      kind: "service",
      title: "Limpieza dental",
      body: "Limpieza dental completa con pulido",
      structured: { price: 250000, durationMinutes: 40 },
      visibility: "customer",
    });
    await facts.createFact(ctx, {
      kind: "service",
      title: "Blanqueamiento",
      body: "Blanqueamiento dental en consultorio",
      structured: { price: 900000 },
      visibility: "customer",
    });
    await facts.createFact(ctx, {
      kind: "note",
      title: "Costo interno de la limpieza dental",
      body: "La limpieza dental nos cuesta 90.000; nunca bajar de 200.000",
      visibility: "internal",
    });
    await facts.createFact(ctx, {
      kind: "policy",
      title: "Cancelación",
      body: "Avisá con 24 horas de anticipación",
      structured: { topic: "cancellation" },
      visibility: "customer",
    });
    // An AI suggestion nobody confirmed: present in the table, invisible to
    // any customer-facing prompt until an admin says otherwise.
    await facts.createFact(
      ctx,
      {
        kind: "service",
        title: "Limpieza dental premium",
        body: "Limpieza dental con flúor y ozono",
        structured: { price: 400000 },
        visibility: "customer",
      },
      { source: "ai_suggested" },
    );

    await facts.createFact(otherCtx, {
      kind: "service",
      title: "Limpieza dental del otro consultorio",
      body: "Esta no es de la clínica A",
      structured: { price: 111111 },
      visibility: "customer",
    });
  });

  it("answers '¿cuánto cuesta la limpieza dental?' from the confirmed service fact", async () => {
    const context = await memory.buildMemoryContext(ctx, {
      query: "hola, ¿cuánto cuesta la limpieza dental?",
      audience: "customer",
    });

    expect(context.block).toContain("Limpieza dental");
    expect(context.block).toContain("250.000 Gs");
    // Always-included, budget or no budget (§16.4).
    expect(context.block).toContain("Av. España 123");
    expect(context.block).toContain("Avisá con 24 horas");
  });

  it("never puts the internal note or an unconfirmed suggestion in the prompt", async () => {
    const context = await memory.buildMemoryContext(ctx, {
      query: "¿cuánto cuesta la limpieza dental?",
      audience: "customer",
    });

    expect(context.block).not.toContain("nunca bajar");
    expect(context.block).not.toContain("Costo interno");
    expect(context.block).not.toContain("premium");

    // And through the prompt builder the reply path actually uses, because
    // that is the string that reaches the provider.
    const prompt = buildSystemPrompt({ businessName: "Clínica Sonrisa", memory: context.block });
    expect(prompt).toContain("250.000 Gs");
    expect(prompt).not.toContain("nunca bajar");
  });

  it("shows the internal note to the setup assistant's brief", async () => {
    const context = await memory.buildMemoryContext(ctx, {
      query: "limpieza dental",
      audience: "internal",
    });
    expect(context.block).toContain("Costo interno de la limpieza dental");
  });

  it("never returns another tenant's facts", async () => {
    const context = await memory.buildMemoryContext(ctx, {
      query: "limpieza dental",
      audience: "customer",
    });
    expect(context.block).not.toContain("otro consultorio");

    const other = await memory.buildMemoryContext(otherCtx, {
      query: "limpieza dental",
      audience: "customer",
    });
    expect(other.block).toContain("otro consultorio");
    expect(other.block).not.toContain("250.000");
  });

  it("stays inside the token budget by dropping retrieved facts, never the policies", async () => {
    const context = await memory.buildMemoryContext(ctx, {
      query: "limpieza dental blanqueamiento",
      audience: "customer",
      budgetTokens: 90,
    });

    // The always-facts are not negotiable, so a tight budget shows up as
    // dropped *retrieved* facts — never as a reply that forgot the
    // cancellation policy (§16.4).
    expect(context.block).toContain("Avisá con 24 horas");
    expect(context.selection.truncated).toBe(true);
    expect(context.selection.matched).toHaveLength(0);
  });

  it("confirming an AI suggestion is what lets it reach a customer", async () => {
    const suggested = (await facts.listUnconfirmedFacts(ctx))[0];
    expect(suggested?.title).toBe("Limpieza dental premium");

    await facts.confirmFact(ctx, suggested!.id, "admin-memoria");

    const context = await memory.buildMemoryContext(ctx, {
      query: "limpieza dental premium con flúor",
      audience: "customer",
    });
    expect(context.block).toContain("Limpieza dental premium");
  });

  it("caches the completion percentage the checklist computes", async () => {
    const pct = await profile.refreshCompletedPct(ctx, true);
    const stored = await profile.getProfile(ctx);
    expect(stored?.completedPct).toBe(pct);
    expect(pct).toBeGreaterThan(0);
  });
});
