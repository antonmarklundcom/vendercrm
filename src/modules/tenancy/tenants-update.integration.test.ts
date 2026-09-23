import { afterAll, beforeAll, describe, expect, it } from "vitest";

// updateTenant (the console's "Editar empresa") and a bulk suspend/activate
// loop, against a real database — the property that matters for both is one
// a unit test with a mock can't see: the row actually changes, an audit
// entry is written, and a colliding slug is rejected without touching
// anything.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("updateTenant (MySQL integration)", () => {
  type SuperadminContext = import("./context").SuperadminContext;
  let tenants: typeof import("./tenants");
  let newId: (typeof import("@/lib/ids"))["newId"];
  const superadmin: SuperadminContext = { userId: "sa-update", impersonatorUserId: null };

  beforeAll(async () => {
    tenants = await import("./tenants");
    ({ newId } = await import("@/lib/ids"));
  });

  it("updates name, slug, locale and timezone, and writes an audit entry of what changed", async () => {
    const { listAuditLogForTenant } = await import("./audit");
    const label = `Editar ${newId()}`;
    const tenant = await tenants.createTenant(superadmin, {
      name: label,
      slug: `editar-${newId()}`.toLowerCase(),
    });

    const updated = await tenants.updateTenant(superadmin, tenant!.id, {
      name: `${label} SA`,
      slug: `${tenant!.slug}-2`,
      locale: "en",
      timezone: "Europe/Stockholm",
    });

    expect(updated?.name).toBe(`${label} SA`);
    expect(updated?.slug).toBe(`${tenant!.slug}-2`);
    expect(updated?.locale).toBe("en");
    expect(updated?.timezone).toBe("Europe/Stockholm");

    const log = await listAuditLogForTenant(tenant!.id);
    const entry = log.find((row) => row.action === "tenant.updated");
    expect(entry).toBeTruthy();
    expect(entry?.payload).toMatchObject({
      name: `${label} SA`,
      slug: `${tenant!.slug}-2`,
      locale: "en",
      timezone: "Europe/Stockholm",
    });
  });

  it("rejects a slug already used by another business, changing nothing", async () => {
    const a = await tenants.createTenant(superadmin, {
      name: `A ${newId()}`,
      slug: `slug-a-${newId()}`.toLowerCase(),
    });
    const b = await tenants.createTenant(superadmin, {
      name: `B ${newId()}`,
      slug: `slug-b-${newId()}`.toLowerCase(),
    });

    await expect(
      tenants.updateTenant(superadmin, b!.id, {
        name: b!.name,
        slug: a!.slug,
        locale: b!.locale,
        timezone: b!.timezone,
      }),
    ).rejects.toThrow(tenants.TenantUpdateError);

    const untouched = await tenants.getTenant(b!.id);
    expect(untouched?.slug).toBe(b!.slug);
  });

  it("keeping the same slug on the same tenant is not a collision with itself", async () => {
    const tenant = await tenants.createTenant(superadmin, {
      name: `Self ${newId()}`,
      slug: `self-${newId()}`.toLowerCase(),
    });

    const updated = await tenants.updateTenant(superadmin, tenant!.id, {
      name: `Self ${newId()} renamed`,
      slug: tenant!.slug,
      locale: tenant!.locale,
      timezone: tenant!.timezone,
    });

    expect(updated?.slug).toBe(tenant!.slug);
  });
});

describe.skipIf(!hasDb)("bulk suspend/activate (MySQL integration)", () => {
  type SuperadminContext = import("./context").SuperadminContext;
  let tenants: typeof import("./tenants");
  let newId: (typeof import("@/lib/ids"))["newId"];
  const superadmin: SuperadminContext = { userId: "sa-bulk", impersonatorUserId: null };

  beforeAll(async () => {
    tenants = await import("./tenants");
    ({ newId } = await import("@/lib/ids"));
  });

  it("suspends and reactivates a batch of businesses without touching a third one left alone", async () => {
    const a = await tenants.createTenant(superadmin, { name: `Bulk A ${newId()}`, slug: `bulk-a-${newId()}`.toLowerCase() });
    const b = await tenants.createTenant(superadmin, { name: `Bulk B ${newId()}`, slug: `bulk-b-${newId()}`.toLowerCase() });
    const untouched = await tenants.createTenant(superadmin, { name: `Bulk C ${newId()}`, slug: `bulk-c-${newId()}`.toLowerCase() });

    for (const id of [a!.id, b!.id]) {
      await tenants.suspendTenant(superadmin, id);
    }

    expect((await tenants.getTenant(a!.id))?.status).toBe("suspended");
    expect((await tenants.getTenant(b!.id))?.status).toBe("suspended");
    expect((await tenants.getTenant(untouched!.id))?.status).toBe("trial");

    for (const id of [a!.id, b!.id]) {
      await tenants.activateTenant(superadmin, id);
    }

    expect((await tenants.getTenant(a!.id))?.status).toBe("active");
    expect((await tenants.getTenant(b!.id))?.status).toBe("active");
  });
});
