import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The contacts feed's unauthenticated token lookup, against a real database
// (PLAN.md §14 I1 #2). It used to scan every tenant; it is now one indexed
// match on the token's SHA-256. These cases pin the behavior that must not
// change with the mechanism: the right token resolves, a wrong one doesn't,
// rotation kills the old link, and clearing kills the current one.

const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("contacts feed token (MySQL integration)", () => {
  let settings: typeof import("./settings");
  type TenantContext = import("./context").TenantContext;
  let ctx: TenantContext;
  let tenantId: string;

  beforeAll(async () => {
    settings = await import("./settings");
    const { newId } = await import("@/lib/ids");
    const { createTenant } = await import("./tenants");

    const superadmin = { userId: "sa-feed-token", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, {
      name: `Feed ${newId()}`,
      slug: `feed-${newId()}`,
    });
    tenantId = tenant!.id;
    ctx = {
      tenantId,
      userId: "system",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };
  });

  it("resolves its own tenant and nothing else", async () => {
    const token = await settings.regenerateContactsFeedToken(ctx);
    const resolved = await settings.resolveTenantByContactsFeedToken(token);
    expect(resolved?.id).toBe(tenantId);
  });

  it("refuses a token that was never issued", async () => {
    const bogus = "f".repeat(48);
    expect(await settings.resolveTenantByContactsFeedToken(bogus)).toBeNull();
  });

  it("stops resolving the previous token after a rotation", async () => {
    const first = await settings.regenerateContactsFeedToken(ctx);
    const second = await settings.regenerateContactsFeedToken(ctx);
    expect(first).not.toBe(second);

    expect(await settings.resolveTenantByContactsFeedToken(first)).toBeNull();
    expect((await settings.resolveTenantByContactsFeedToken(second))?.id).toBe(tenantId);
  });

  it("stops resolving once the token is cleared", async () => {
    const token = await settings.regenerateContactsFeedToken(ctx);
    await settings.clearContactsFeedToken(ctx);
    expect(await settings.resolveTenantByContactsFeedToken(token)).toBeNull();
  });

  it("writes a hash the database itself agrees with", async () => {
    // The migration backfilled existing tokens with MySQL's SHA2(x, 256).
    // If the app ever wrote a different digest, old feed URLs would resolve
    // and new ones wouldn't (or the reverse) — so assert the two agree.
    const token = await settings.regenerateContactsFeedToken(ctx);
    const { db } = await import("@/db/client");
    const { tenants } = await import("@/db/schema");
    const { eq, sql } = await import("drizzle-orm");

    const [row] = await db
      .select({
        stored: tenants.contactsFeedTokenHash,
        mysql: sql<string>`SHA2(${token}, 256)`,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId));

    expect(row.stored).toBe(row.mysql);
  });
});
