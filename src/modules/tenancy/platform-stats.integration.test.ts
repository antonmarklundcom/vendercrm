import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The console's numbers, against a real database. Globals (total tenants,
// total users) are not asserted — this suite shares a database with every
// other one — so each case checks the row or the delta it created itself,
// which is what the page's correctness actually rests on.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("platform stats (MySQL integration)", () => {
  let stats: typeof import("./platform-stats");
  let newId: (typeof import("@/lib/ids"))["newId"];

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  let ctx: TenantContext;
  let tenantId: string;
  let tenantName: string;

  beforeAll(async () => {
    stats = await import("./platform-stats");
    ({ newId } = await import("@/lib/ids"));
    const { createTenant } = await import("./tenants");
    const contacts = await import("@/modules/crm/contacts");
    const pipelines = await import("@/modules/crm/pipelines");
    const deals = await import("@/modules/crm/deals");

    const superadmin = { userId: "sa-stats", impersonatorUserId: null } as const;
    tenantName = `Stats ${newId()}`;
    const tenant = await createTenant(superadmin, {
      name: tenantName,
      slug: `stats-${newId()}`,
    });
    tenantId = tenant!.id;

    ctx = {
      tenantId,
      userId: "system",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };

    const contact = await contacts.createContact(ctx, {
      name: "Cliente de prueba",
      phone: `0984${Math.floor(Math.random() * 900000) + 100000}`,
    });
    const pipeline = await pipelines.createPipelineWithDefaultStages(ctx, "Ventas");
    const stageRows = await pipelines.listStagesForPipeline(ctx, pipeline!.id);
    const open = stageRows.find((stage) => !stage.isWon && !stage.isLost)!;
    await deals.createDeal(ctx, {
      contactId: contact!.id,
      pipelineId: pipeline!.id,
      stageId: open.id,
      title: "Negocio de prueba",
    });
  });

  it("counts what this tenant just created inside the window", async () => {
    const window = stats.windowOf(30);
    const rows = await stats.listTenantActivity(window);
    const mine = rows.find((row) => row.tenantId === tenantId);

    expect(mine).toBeDefined();
    expect(mine!.tenantName).toBe(tenantName);
    expect(mine!.contacts).toBe(1);
    // No WhatsApp account, so no messages — and "never messaged" is a real
    // state the page renders differently from a zero.
    expect(mine!.messages).toBe(0);
    expect(mine!.lastMessageAt).toBeNull();
    expect(mine!.dealsWon).toBe(0);
    expect(mine!.wonValue).toBe(0);
    expect(mine!.leadsPrevious).toBe(0);

    // No lead submissions for this business, so it has no source row — the
    // query itself still has to run on MySQL (grouping + ordering by count).
    const sources = await stats.listTopLeadSources(window);
    expect(sources.some((row) => row.tenantId === tenantId)).toBe(false);
  });

  it("excludes it from a window that closed before it existed", async () => {
    // A window ending in the past: the seeded rows are newer than `since`
    // only for the current window, so this proves the date filter is real
    // rather than the query returning everything.
    const ancient = {
      days: 30,
      since: new Date("2020-01-01T00:00:00Z"),
    };
    const wide = await stats.getPlatformActivity(ancient);
    const narrow = await stats.getPlatformActivity({
      days: 0,
      since: new Date(Date.now() + 60 * 1000),
    });

    expect(wide.contactsCreated).toBeGreaterThan(0);
    expect(narrow.contactsCreated).toBe(0);
    expect(narrow.dealsCreated).toBe(0);
  });

  it("reports the platform totals as numbers, not strings", async () => {
    // MySQL's COUNT comes back as a string through some drivers; the page
    // formats these, so a string here shows up as "1.234" in the wrong place.
    const totals = await stats.getPlatformTotals();
    for (const value of [
      totals.tenants,
      totals.users,
      totals.memberships,
      totals.contacts,
      totals.openDeals,
      totals.multiBusinessUsers,
    ]) {
      expect(typeof value).toBe("number");
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(totals.tenants).toBeGreaterThan(0);
  });
});
