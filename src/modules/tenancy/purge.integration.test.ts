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

describe.skipIf(!hasDb)("deleteTenant storage cleanup (local driver)", () => {
  const superadmin = { userId: "sa-purge-storage", impersonatorUserId: null } as const;
  let purge: typeof import("./purge");
  let storage: (typeof import("@/lib/storage"))["storage"];
  let doomed: string;
  let neighbour: string;
  let doomedFileKeys: string[];
  let neighbourKey: string;

  beforeAll(async () => {
    purge = await import("./purge");
    ({ storage } = await import("@/lib/storage"));
    const { newId } = await import("@/lib/ids");
    const { createTenant } = await import("./tenants");
    doomed = (await createTenant(superadmin, { name: "Borrar-storage", slug: `borrar-storage-${newId()}`.toLowerCase() }))!.id;
    neighbour = (await createTenant(superadmin, { name: "Vecino-storage", slug: `vecino-storage-${newId()}`.toLowerCase() }))!.id;

    // Two kinds for the doomed business, one for its neighbour — exercising
    // both the per-kind prefix sweep and that it never crosses tenants.
    doomedFileKeys = [`quotes/${doomed}/${newId()}.bin`, `whatsapp-media/${doomed}/${newId()}.bin`];
    for (const key of doomedFileKeys) {
      await storage.put(key, Buffer.from("bye"), "application/octet-stream");
    }
    neighbourKey = `quotes/${neighbour}/${newId()}.bin`;
    await storage.put(neighbourKey, Buffer.from("stay"), "application/octet-stream");
  });

  afterAll(async () => {
    await storage.delete(neighbourKey).catch(() => {});
    await purge.deleteTenant(superadmin, neighbour).catch(() => {});
  });

  it("deletes the business's files and leaves its neighbour's alone", async () => {
    expect(await purge.deleteTenant(superadmin, doomed)).toBe(true);

    for (const key of doomedFileKeys) {
      await expect(storage.get(key)).rejects.toThrow();
    }
    await expect(storage.get(neighbourKey)).resolves.toEqual(Buffer.from("stay"));
  });
});
