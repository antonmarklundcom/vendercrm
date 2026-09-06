import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Needs a real MySQL — buildBriefingInput reads sales/Hoy data through
// tenantDb, and createWeeklyBriefing's idempotency is backstopped by a real
// unique index, same reason contracts.integration.test.ts requires one.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("weekly briefing generation (MySQL)", () => {
  let newId: (typeof import("@/lib/ids"))["newId"];
  let createTenant: (typeof import("@/modules/tenancy/tenants"))["createTenant"];
  let buildSystemTenantContext: (typeof import("@/modules/tenancy/context"))["buildSystemTenantContext"];
  let updateTenantAiSettings: (typeof import("@/modules/tenancy/settings"))["updateTenantAiSettings"];

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  const superadmin = { userId: "sa-test", impersonatorUserId: null } as const;

  let ctx: TenantContext;

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    ({ createTenant } = await import("@/modules/tenancy/tenants"));
    ({ buildSystemTenantContext } = await import("@/modules/tenancy/context"));
    ({ updateTenantAiSettings } = await import("@/modules/tenancy/settings"));

    const tenant = await createTenant(superadmin, {
      name: "Briefing Co",
      slug: `briefing-${newId()}`,
    });
    ctx = (await buildSystemTenantContext(tenant!.id))!;
  });

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("@/lib/ai");
  });

  afterAll(async () => {
    const { db } = await import("@/db/client");
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  const WEEK_START = "2026-09-07"; // a Monday

  function mockDriver(generateStructured: (...args: unknown[]) => unknown) {
    vi.doMock("@/lib/ai", () => ({
      getAiDriver: () => ({
        provider: "openai",
        model: "stub-model",
        generateReply: vi.fn(),
        generateStructured,
      }),
    }));
  }

  it("AI off: falls back to the template narrative without touching the driver", async () => {
    vi.doMock("@/lib/ai", () => ({ getAiDriver: () => null }));
    const { generateBriefing } = await import("./briefing");

    const result = await generateBriefing(ctx, WEEK_START);
    expect(result.source).toBe("template");
    expect(result.recommendations).toHaveLength(3);
  });

  it("AI path: a valid, verified generation is used as-is", async () => {
    const generateStructured = vi.fn().mockResolvedValue({
      data: {
        summary: "Fue una semana tranquila, sin sobresaltos.",
        recommendations: ["Uno.", "Dos.", "Tres."],
        citedMetrics: ["leadsThisWeek"],
      },
      raw: "{}",
      model: "stub-model",
      promptTokens: 10,
      completionTokens: 5,
      attempts: 1,
    });
    mockDriver(generateStructured);
    const { generateBriefing } = await import("./briefing");

    const result = await generateBriefing(ctx, WEEK_START);
    expect(result.source).toBe("ai");
    expect(result.summary).toBe("Fue una semana tranquila, sin sobresaltos.");
    expect(generateStructured).toHaveBeenCalledOnce();
  });

  it("invalid output: an invented number fails verification and falls back to the template", async () => {
    const generateStructured = vi.fn().mockResolvedValue({
      data: {
        summary: "Recibiste 9999 leads esta semana, un récord histórico.",
        recommendations: ["Uno.", "Dos.", "Tres."],
        citedMetrics: [],
      },
      raw: "{}",
      model: "stub-model",
      promptTokens: 10,
      completionTokens: 5,
      attempts: 1,
    });
    mockDriver(generateStructured);
    const { generateBriefing } = await import("./briefing");

    const result = await generateBriefing(ctx, WEEK_START);
    expect(result.source).toBe("template");
  });

  it("cap hit: never calls the driver once the tenant's daily AI cap is reached", async () => {
    await updateTenantAiSettings(ctx, { maxRepliesPerTenantPerDay: 0 });
    const generateStructured = vi.fn();
    mockDriver(generateStructured);
    const { generateBriefing } = await import("./briefing");

    const result = await generateBriefing(ctx, WEEK_START);
    expect(result.source).toBe("template");
    expect(generateStructured).not.toHaveBeenCalled();

    await updateTenantAiSettings(ctx, { maxRepliesPerTenantPerDay: undefined });
  });
});
