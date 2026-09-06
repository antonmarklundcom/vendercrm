import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Public form submission against a tenant-defined field set (PLAN.md §17.3
// "P15/P17" P17 half): required/select re-validated server-side, and a
// `mapTo` answer lands on the contact's own `custom` JSON.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("form submission against custom field definitions (MySQL integration)", () => {
  let newId: (typeof import("@/lib/ids"))["newId"];
  let formsModule: typeof import("./forms");
  let submissionsModule: typeof import("./submissions");
  let customFields: typeof import("@/modules/crm/custom-fields");
  let contacts: typeof import("@/modules/crm/contacts");

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  let ctx: TenantContext;
  let tenantSlug: string;

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    formsModule = await import("./forms");
    submissionsModule = await import("./submissions");
    customFields = await import("@/modules/crm/custom-fields");
    contacts = await import("@/modules/crm/contacts");
    const { createTenant } = await import("@/modules/tenancy/tenants");

    const superadmin = { userId: "sa-p17-forms", impersonatorUserId: null } as const;
    tenantSlug = `p17-forms-${newId()}`;
    const tenant = await createTenant(superadmin, {
      name: `P17 Forms ${newId()}`,
      slug: tenantSlug,
    });
    ctx = {
      tenantId: tenant!.id,
      userId: "system",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };
  });

  async function makeForm() {
    const rubro = await customFields.createCustomFieldDefinition(ctx, {
      label: `Rubro ${newId()}`,
      type: "select",
      options: ["Ferretería", "Panadería"],
    });

    const form = await formsModule.createForm(ctx, {
      name: "Contacto",
      slug: `contacto-${newId()}`,
      fields: [
        { key: "phone", label: "Teléfono", type: "phone", required: true },
        { key: "nombre", label: "Nombre", type: "text", required: true },
        {
          key: "rubro",
          label: "Rubro",
          type: "select",
          required: false,
          options: ["Ferretería", "Panadería"],
            mapTo: rubro!.key,
        },
      ],
    });
    return { form: form!, rubroKey: rubro!.key };
  }

  it("throws when a required field is missing", async () => {
    const { form } = await makeForm();
    await expect(
      submissionsModule.submitForm(tenantSlug, form.slug, {
        data: { phone: `0981${String(Math.floor(Math.random() * 900000) + 100000)}` },
      }),
    ).rejects.toThrow(/field_required:nombre/);
  });

  it("throws when a select answer isn't one of its own options", async () => {
    const { form } = await makeForm();
    await expect(
      submissionsModule.submitForm(tenantSlug, form.slug, {
        data: {
          phone: `0982${String(Math.floor(Math.random() * 900000) + 100000)}`,
          nombre: "Doña Rosa",
          rubro: "Ropa",
        },
      }),
    ).rejects.toThrow(/invalid_option:rubro/);
  });

  it("writes a mapped answer into the contact's custom fields", async () => {
    const { form, rubroKey } = await makeForm();
    const phone = `0983${String(Math.floor(Math.random() * 900000) + 100000)}`;

    const result = await submissionsModule.submitForm(tenantSlug, form.slug, {
      data: { phone, nombre: "Doña Rosa", rubro: "Panadería" },
    });

    const contact = await contacts.getContact(ctx, result.contactId);
    expect((contact!.custom as Record<string, unknown>)[rubroKey]).toBe("Panadería");
  });
});
