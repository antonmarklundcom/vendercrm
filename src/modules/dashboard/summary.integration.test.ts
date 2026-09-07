import { afterAll, beforeAll, describe, expect, it } from "vitest";

// getDashboardSummary's unread counters used to `db.select(conversations)`
// and reduce over every row in Node just to sum/count one column — the
// "notification bell" hot spot (§14 perf pass). This pins the observable
// numbers (sum of unreadCount, count of conversations with unreadCount > 0)
// against real rows in a real MySQL, tenant-scoped, so the SQL aggregation
// swapped in for it can't silently drift from the old in-Node behavior.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("dashboard unread counters (MySQL integration)", () => {
  let newId: (typeof import("@/lib/ids"))["newId"];
  let conversations: (typeof import("@/db/schema"))["conversations"];
  let tenantDb: (typeof import("@/modules/tenancy/db"))["tenantDb"];
  let createTenant: (typeof import("@/modules/tenancy/tenants"))["createTenant"];
  let getDashboardSummary: (typeof import("./summary"))["getDashboardSummary"];

  type TenantContext = import("@/modules/tenancy/context").TenantContext;

  let ctx: TenantContext;
  let otherCtx: TenantContext;

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    ({ conversations } = await import("@/db/schema"));
    ({ tenantDb } = await import("@/modules/tenancy/db"));
    ({ createTenant } = await import("@/modules/tenancy/tenants"));
    ({ getDashboardSummary } = await import("./summary"));

    const superadmin = { userId: "sa-dash", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, {
      name: `Dash ${newId()}`,
      slug: `dash-${newId()}`,
    });
    const other = await createTenant(superadmin, {
      name: `Dash Other ${newId()}`,
      slug: `dashot-${newId()}`,
    });

    ctx = {
      tenantId: tenant!.id,
      userId: "system",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };
    otherCtx = { ...ctx, tenantId: other!.id };
  });

  async function seedConversation(context: TenantContext, unreadCount: number) {
    const id = newId();
    await tenantDb(context)
      .insert(conversations)
      .values({
        id,
        waAccountId: newId(),
        contactId: newId(),
        status: "open",
        unreadCount,
      });
  }

  it("sums unread messages and counts unread conversations in SQL, not in Node", async () => {
    // Three conversations with unread messages (2 + 5 + 0 read, one at 0
    // stays "read"), plus one fully-read conversation.
    await seedConversation(ctx, 2);
    await seedConversation(ctx, 5);
    await seedConversation(ctx, 0);

    // Noise on another tenant: must not leak into this tenant's numbers.
    await seedConversation(otherCtx, 100);

    const summary = await getDashboardSummary(ctx);
    expect(summary.stats.unreadMessages).toBe(7);
    expect(summary.stats.unreadConversations).toBe(2);

    const otherSummary = await getDashboardSummary(otherCtx);
    expect(otherSummary.stats.unreadMessages).toBe(100);
    expect(otherSummary.stats.unreadConversations).toBe(1);
  });

  it("reports zero for a tenant with no conversations", async () => {
    const superadmin = { userId: "sa-dash", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, {
      name: `Dash Empty ${newId()}`,
      slug: `dashempty-${newId()}`,
    });
    const emptyCtx: TenantContext = { ...ctx, tenantId: tenant!.id };

    const summary = await getDashboardSummary(emptyCtx);
    expect(summary.stats.unreadMessages).toBe(0);
    expect(summary.stats.unreadConversations).toBe(0);
  });
});
