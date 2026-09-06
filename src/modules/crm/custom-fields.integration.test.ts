import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Custom fields (PLAN.md §15.8 P5): a select field round-trips create →
// import → export → filter, and SQL-side pagination pages a real 3-page
// result set the same way the in-memory version used to.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("custom fields + SQL pagination (MySQL integration)", () => {
  let newId: (typeof import("@/lib/ids"))["newId"];
  let customFields: typeof import("./custom-fields");
  let contacts: typeof import("./contacts");
  let contactList: typeof import("./contact-list");
  let importer: typeof import("./import");
  let exporter: typeof import("./export");

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  let ctx: TenantContext;

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    customFields = await import("./custom-fields");
    contacts = await import("./contacts");
    contactList = await import("./contact-list");
    importer = await import("./import");
    exporter = await import("./export");
    const { createTenant } = await import("@/modules/tenancy/tenants");

    const superadmin = { userId: "sa-p5-cf", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, {
      name: `CustomFields ${newId()}`,
      slug: `cf-${newId()}`,
    });
    ctx = {
      tenantId: tenant!.id,
      userId: "system",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };
  });

  it("round-trips a select field: create → import → export → filter", async () => {
    const field = await customFields.createCustomFieldDefinition(ctx, {
      label: "Rubro",
      type: "select",
      options: ["Ferretería", "Panadería"],
    });
    expect(field?.key).toBe("rubro");

    const report = await importer.importContacts(
      ctx,
      [{ nombre: "Doña Rosa", telefono: `0981${Math.floor(Math.random() * 900000) + 100000}`, rubro: "Panadería" }],
      {
        mapping: { name: "nombre", phone: "telefono", custom: { rubro: "rubro" } },
        onDuplicate: "update",
      },
    );
    expect(report.created).toBe(1);

    const csv = await exporter.exportContactsCsv(ctx, {});
    expect(csv).toContain("Rubro");
    expect(csv).toContain("Panadería");

    const filtered = await contactList.queryContacts(ctx, {
      customKey: "rubro",
      customOp: "equals",
      customValue: "Panadería",
    });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0].name).toBe("Doña Rosa");

    const noMatch = await contactList.queryContacts(ctx, {
      customKey: "rubro",
      customOp: "equals",
      customValue: "Ferretería",
    });
    expect(noMatch.rows).toHaveLength(0);

    const contains = await contactList.queryContacts(ctx, {
      customKey: "rubro",
      customOp: "contains",
      customValue: "Pan",
    });
    expect(contains.rows).toHaveLength(1);
  });

  it("drops an unparseable value for a typed field rather than failing the row", async () => {
    const field = await customFields.createCustomFieldDefinition(ctx, {
      label: "Edad",
      type: "number",
    });

    const report = await importer.importContacts(
      ctx,
      [
        {
          nombre: "Juan",
          telefono: `0982${Math.floor(Math.random() * 900000) + 100000}`,
          edad: "no es un número",
        },
      ],
      {
        mapping: { name: "nombre", phone: "telefono", custom: { [field!.key]: "edad" } },
        onDuplicate: "update",
      },
    );
    expect(report.created).toBe(1);

    const [created] = report.errors;
    expect(created).toBeUndefined(); // the row itself still succeeds
  });

  it("pages a real result set across 3 pages with SQL LIMIT/OFFSET", async () => {
    const prefix = `Paginado ${newId()}`;
    for (let i = 0; i < 7; i += 1) {
      await contacts.createContact(ctx, {
        name: `${prefix} ${i}`,
        phone: `0983${(100000 + i).toString()}`,
      });
    }

    const page1 = await contactList.queryContacts(
      ctx,
      { search: prefix },
      { perPage: 3, page: 1, sort: "name", direction: "asc" },
    );
    const page2 = await contactList.queryContacts(
      ctx,
      { search: prefix },
      { perPage: 3, page: 2, sort: "name", direction: "asc" },
    );
    const page3 = await contactList.queryContacts(
      ctx,
      { search: prefix },
      { perPage: 3, page: 3, sort: "name", direction: "asc" },
    );

    expect(page1.total).toBe(7);
    expect(page1.pageCount).toBe(3);
    expect(page1.rows).toHaveLength(3);
    expect(page2.rows).toHaveLength(3);
    expect(page3.rows).toHaveLength(1);

    const allIds = [...page1.rows, ...page2.rows, ...page3.rows].map((r) => r.id);
    expect(new Set(allIds).size).toBe(7); // no overlap, nothing missing
  });
});
