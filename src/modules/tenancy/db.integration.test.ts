import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// tenantDb().count / .sum (PLAN.md §14 perf pass): the tenant-scoped access
// layer's only aggregate helpers, added so callers stop fetching every row
// just to read `.length` or reduce a column. Exercised directly against the
// `deals` table (no foreign keys in this schema, §4 — arbitrary ids are
// fine) so a regression here shows up before it reaches every caller that
// switches to it.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("tenantDb count/sum (MySQL integration)", () => {
  let newId: (typeof import("@/lib/ids"))["newId"];
  let deals: (typeof import("@/db/schema"))["deals"];
  let tenantDb: (typeof import("./db"))["tenantDb"];
  let createTenant: (typeof import("./tenants"))["createTenant"];

  type TenantContext = import("./context").TenantContext;

  let ctx: TenantContext;
  let otherCtx: TenantContext;
  let stageAId: string;
  let stageBId: string;

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    ({ deals } = await import("@/db/schema"));
    ({ tenantDb } = await import("./db"));
    ({ createTenant } = await import("./tenants"));

    const superadmin = { userId: "sa-count", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, {
      name: `Count ${newId()}`,
      slug: `count-${newId()}`,
    });
    const other = await createTenant(superadmin, {
      name: `Count Other ${newId()}`,
      slug: `countot-${newId()}`,
    });

    ctx = {
      tenantId: tenant!.id,
      userId: "system",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };
    otherCtx = { ...ctx, tenantId: other!.id };
    stageAId = newId();
    stageBId = newId();

    async function seed(context: TenantContext, stageId: string, value: number) {
      await tenantDb(context)
        .insert(deals)
        .values({
          id: newId(),
          contactId: newId(),
          pipelineId: newId(),
          stageId,
          title: "Seed",
          value,
        });
    }

    // 3 deals in stage A (values 100, 200, 300), 1 in stage B — for this
    // tenant.
    await seed(ctx, stageAId, 100);
    await seed(ctx, stageAId, 200);
    await seed(ctx, stageAId, 300);
    await seed(ctx, stageBId, 999);

    // Noise on another tenant, in the *same* stage id, that must never be
    // counted or summed into tenant A's numbers.
    await seed(otherCtx, stageAId, 5000);
    await seed(otherCtx, stageAId, 5000);
  });

  it("counts only this tenant's rows matching the filter", async () => {
    await expect(tenantDb(ctx).count(deals, eq(deals.stageId, stageAId))).resolves.toBe(3);
    await expect(tenantDb(ctx).count(deals, eq(deals.stageId, stageBId))).resolves.toBe(1);
    await expect(tenantDb(otherCtx).count(deals, eq(deals.stageId, stageAId))).resolves.toBe(2);
  });

  it("counts every row for the tenant when no filter is given", async () => {
    await expect(tenantDb(ctx).count(deals)).resolves.toBe(4);
  });

  it("sums a column across only this tenant's matching rows", async () => {
    await expect(tenantDb(ctx).sum(deals, deals.value, eq(deals.stageId, stageAId))).resolves.toBe(
      600,
    );
    await expect(tenantDb(otherCtx).sum(deals, deals.value, eq(deals.stageId, stageAId))).resolves.toBe(
      10000,
    );
  });

  it("returns 0, not null, for a filter that matches nothing", async () => {
    const noStage = newId();
    await expect(tenantDb(ctx).count(deals, eq(deals.stageId, noStage))).resolves.toBe(0);
    await expect(tenantDb(ctx).sum(deals, deals.value, eq(deals.stageId, noStage))).resolves.toBe(0);
  });
});
