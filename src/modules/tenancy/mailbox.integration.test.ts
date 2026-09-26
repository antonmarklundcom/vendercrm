import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The per-tenant mailbox switch (PLAN-EMAIL.md §3, E1) against a real
// tenants row: default off, the toggle and the suspension clear are audited,
// and availability needs both the platform config and the tenant flag.

const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("mailbox switch (MySQL integration)", () => {
  const configured = {
    CLOUDFLARE_ACCOUNT_ID: "acc",
    CLOUDFLARE_EMAIL_API_TOKEN: "tok",
    EMAIL_INBOUND_SECRET: "secret",
  };
  const superadmin = { userId: "sa-e1", impersonatorUserId: null } as const;
  let tenantId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    const { newId } = await import("@/lib/ids");
    const { createTenant } = await import("@/modules/tenancy/tenants");
    tenantId = (await createTenant(superadmin, { name: "E1", slug: `e1-${newId()}` }))!.id;
    otherTenantId = (await createTenant(superadmin, { name: "E1b", slug: `e1b-${newId()}` }))!.id;
  });

  it("starts off, and stays off without platform config even when enabled", async () => {
    const { getTenant } = await import("@/modules/tenancy/tenants");
    const { isMailboxAvailable, setMailboxEnabled } = await import("./mailbox");

    const tenant = await getTenant(tenantId);
    expect(tenant?.mailboxEnabled).toBe(false);
    expect(tenant?.outboundSuspendedAt).toBeNull();
    expect(await isMailboxAvailable({ tenantId }, configured)).toBe(false);

    await setMailboxEnabled(superadmin, tenantId, true);
    expect(await isMailboxAvailable({ tenantId }, {})).toBe(false);
    expect(await isMailboxAvailable({ tenantId }, configured)).toBe(true);
    // Only the tenant that was switched on.
    expect(await isMailboxAvailable({ tenantId: otherTenantId }, configured)).toBe(false);

    await setMailboxEnabled(superadmin, tenantId, false);
    expect(await isMailboxAvailable({ tenantId }, configured)).toBe(false);

    const { listAuditLogForTenant } = await import("./audit");
    const actions = (await listAuditLogForTenant(tenantId)).map((entry) => entry.action);
    expect(actions).toContain("mailbox.enabled");
    expect(actions).toContain("mailbox.disabled");
  });

  it("clears an outbound suspension and audits it", async () => {
    const { eq } = await import("drizzle-orm");
    const { db } = await import("@/db/client");
    const { tenants } = await import("@/db/schema");
    const { getTenant } = await import("@/modules/tenancy/tenants");
    const { clearOutboundSuspension } = await import("./mailbox");
    const { listAuditLogForTenant } = await import("./audit");

    const suspendedAt = new Date("2026-09-20T12:00:00Z");
    await db.update(tenants).set({ outboundSuspendedAt: suspendedAt }).where(eq(tenants.id, tenantId));

    await clearOutboundSuspension(superadmin, tenantId);
    expect((await getTenant(tenantId))?.outboundSuspendedAt).toBeNull();
    const cleared = (await listAuditLogForTenant(tenantId)).filter(
      (entry) => entry.action === "mailbox.suspension_cleared",
    );
    expect(cleared).toHaveLength(1);

    // Nothing to clear: no second audit row.
    await clearOutboundSuspension(superadmin, tenantId);
    expect(
      (await listAuditLogForTenant(tenantId)).filter(
        (entry) => entry.action === "mailbox.suspension_cleared",
      ),
    ).toHaveLength(1);
  });
});
