import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Needs a real MySQL — the unique index on (tenant_id, week_start) is
// exactly what backstops "a second run writes nothing," same reason
// briefing.test.ts and contracts.integration.test.ts require one.
const hasDb = !!process.env.DATABASE_URL;

const MONDAY = "2026-09-07"; // verified Monday

describe.skipIf(!hasDb)("coach.weekly job (MySQL)", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let newId: (typeof import("@/lib/ids"))["newId"];
  let createTenant: (typeof import("@/modules/tenancy/tenants"))["createTenant"];
  let getTenant: (typeof import("@/modules/tenancy/tenants"))["getTenant"];
  let zonedTimeToUtc: (typeof import("@/modules/calendar/zoned-time"))["zonedTimeToUtc"];
  let sendWeeklyBriefings: (typeof import("./briefing-jobs"))["sendWeeklyBriefings"];

  const superadmin = { userId: "sa-test", impersonatorUserId: null } as const;
  let tenantId: string;

  beforeAll(async () => {
    // AI off (no OPENAI key needed): the job's scheduling and idempotency
    // are under test here, not the generation path (covered separately by
    // briefing.test.ts).
    vi.doMock("@/lib/ai", () => ({ getAiDriver: () => null }));

    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    ({ newId } = await import("@/lib/ids"));
    ({ createTenant, getTenant } = await import("@/modules/tenancy/tenants"));
    ({ zonedTimeToUtc } = await import("@/modules/calendar/zoned-time"));

    const tenant = await createTenant(superadmin, {
      name: "Weekly Job Co",
      slug: `weekly-job-${newId()}`,
      timezone: "America/Asuncion",
    });
    tenantId = tenant!.id;

    // The full tenant list in this shared test database is large (every
    // integration test file's fixtures accumulate in it) and scanning all of
    // it on every call is what a real deploy's hourly chain is for, not what
    // this test needs — it only cares that its one tenant gets exactly one
    // briefing. `listTenants` is narrowed to that tenant so the assertions
    // below are about this job's logic, not about how many other fixtures
    // happen to share its timezone.
    vi.doMock("@/modules/tenancy/tenants", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/modules/tenancy/tenants")>();
      return { ...actual, listTenants: async () => [(await getTenant(tenantId))!] };
    });

    ({ sendWeeklyBriefings } = await import("./briefing-jobs"));
  });

  afterAll(async () => {
    vi.doUnmock("@/lib/ai");
    vi.doUnmock("@/modules/tenancy/tenants");
    if (!db) return;
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  it("writes one briefing per tenant on Monday 07:xx, and a second pass writes nothing more", async () => {
    const mondayMorning = zonedTimeToUtc(MONDAY, "07:15", "America/Asuncion");

    const firstPass = await sendWeeklyBriefings(mondayMorning);
    expect(firstPass).toBe(1);
    const afterFirst = await db
      .select()
      .from(schema.coachBriefings)
      .where(eq(schema.coachBriefings.tenantId, tenantId));
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]!.source).toBe("template");

    // A later pass the same hour (the chain runs hourly and could overlap a
    // slow prior run) must not produce a second row for the same week.
    const secondPass = await sendWeeklyBriefings(zonedTimeToUtc(MONDAY, "07:55", "America/Asuncion"));
    expect(secondPass).toBe(0);
    const afterSecond = await db
      .select()
      .from(schema.coachBriefings)
      .where(eq(schema.coachBriefings.tenantId, tenantId));
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]!.id).toBe(afterFirst[0]!.id);
  });

  it("does nothing outside the Monday 07:xx window", async () => {
    const tuesday = zonedTimeToUtc("2026-09-08", "07:15", "America/Asuncion");
    expect(await sendWeeklyBriefings(tuesday)).toBe(0);

    const mondayAfternoon = zonedTimeToUtc(MONDAY, "15:00", "America/Asuncion");
    expect(await sendWeeklyBriefings(mondayAfternoon)).toBe(0);
  });
});
