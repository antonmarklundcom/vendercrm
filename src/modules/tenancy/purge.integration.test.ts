import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Deleting a business, against a real database. The property that matters is
// the one a bug would break silently: the business's rows go from every
// tenant-scoped table, and a neighbouring business keeps every one of its own.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("deleteTenant (MySQL integration)", () => {
  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  let purge: typeof import("./purge");
  let pool: (typeof import("@/db/client"))["pool"];
  const superadmin = { userId: "sa-purge", impersonatorUserId: null } as const;
  let doomed: string;
  let neighbour: string;

  async function seed(label: string): Promise<string> {
    const { newId } = await import("@/lib/ids");
    const { createTenant } = await import("./tenants");
    const contacts = await import("@/modules/crm/contacts");
    const pipelines = await import("@/modules/crm/pipelines");
    const { createSite } = await import("@/modules/sites/sites");
    const tenant = await createTenant(superadmin, { name: label, slug: `${label}-${newId()}`.toLowerCase() });
    const ctx: TenantContext = {
      tenantId: tenant!.id,
      userId: "system",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };
    await contacts.createContact(ctx, {
      name: "Cliente",
      phone: `0985${Math.floor(Math.random() * 900000) + 100000}`,
    });
    await pipelines.createPipelineWithDefaultStages(ctx, "Ventas");
    await createSite(ctx, { name: label, slug: `s-${newId()}`.toLowerCase() });
    return tenant!.id;
  }

  async function rowsFor(tenantId: string): Promise<number> {
    const conn = await pool.getConnection();
    try {
      const counts = await purge.countTenantRows(conn, [tenantId]);
      return counts.reduce((sum, c) => sum + c.rows, 0);
    } finally {
      conn.release();
    }
  }

  beforeAll(async () => {
    purge = await import("./purge");
    ({ pool } = await import("@/db/client"));
    doomed = await seed("Borrar");
    neighbour = await seed("Vecino");
  });

  it("removes the business and every row under it, and nothing of its neighbour", async () => {
    const { getTenant } = await import("./tenants");
    const neighbourBefore = await rowsFor(neighbour);
    expect(await rowsFor(doomed)).toBeGreaterThan(0);

    expect(await purge.deleteTenant(superadmin, doomed)).toBe(true);

    expect(await getTenant(doomed)).toBeNull();
    // audit_log is tenant-scoped too; the deletion's own entry has tenant_id
    // NULL, so this is exactly zero.
    expect(await rowsFor(doomed)).toBe(0);
    expect(await getTenant(neighbour)).not.toBeNull();
    expect(await rowsFor(neighbour)).toBe(neighbourBefore);
  });

  it("answers false for a business that does not exist", async () => {
    expect(await purge.deleteTenant(superadmin, "01NOPE0000000000000000000")).toBe(false);
  });
});
