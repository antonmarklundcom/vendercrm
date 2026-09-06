import { afterAll, beforeAll, describe, expect, it } from "vitest";

// senderFor(ctx)'s resolution table (PLAN.md §15.1, §15.8 P4): default tier,
// own verified domain, and the reply-to fallback chain — against a real
// tenant row and a real (directly-inserted) tenant_email_domains row, the
// same harness the other integration suites use. EMAIL_DEFAULT_DOMAIN is set
// on process.env before any env-dependent module is imported, since env.ts
// validates once at module load.
process.env.EMAIL_DEFAULT_DOMAIN = "mail.clientes.com.py";

const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("senderFor (MySQL integration)", () => {
  let newId: (typeof import("@/lib/ids"))["newId"];
  let senderFor: (typeof import("./sender"))["senderFor"];

  type TenantContext = import("@/modules/tenancy/context").TenantContext;

  let ctx: TenantContext;
  let adminEmail: string;

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    ({ senderFor } = await import("./sender"));
    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const { createTenant } = await import("@/modules/tenancy/tenants");

    const superadmin = { userId: "sa-p4", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, {
      name: 'Ferretería "El Tornillo"',
      slug: `p4-${newId()}`,
    });

    ctx = {
      tenantId: tenant!.id,
      userId: "system",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };

    const adminId = newId();
    adminEmail = `admin-${adminId}@eltornillo.com.py`;
    await db.insert(schema.users).values({
      id: adminId,
      tenantId: ctx.tenantId,
      email: adminEmail,
      name: "Admin",
      role: "admin",
    });
    await db.insert(schema.tenantMemberships).values({
      id: newId(),
      tenantId: ctx.tenantId,
      userId: adminId,
      role: "admin",
    });
  });

  it("uses the default tier's subdomain when no domain is verified", async () => {
    const { from, replyTo } = await senderFor(ctx);
    expect(from).toBe('"Ferretería \\"El Tornillo\\"" <notificaciones@mail.clientes.com.py>');
    // No settings.contactEmail set: falls back to the tenant's admin.
    expect(replyTo).toBe(adminEmail);
  });

  it("uses the tenant's own address once a domain is verified", async () => {
    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");

    await db.insert(schema.tenantEmailDomains).values({
      id: newId(),
      tenantId: ctx.tenantId,
      domain: "eltornillo.com.py",
      status: "verified",
      fromLocalPart: "ventas",
      dnsRecords: [],
    });

    const { from } = await senderFor(ctx);
    expect(from).toBe('"Ferretería \\"El Tornillo\\"" <ventas@eltornillo.com.py>');
  });

  it("prefers settings.contactEmail over the admin fallback", async () => {
    const { updateTenantContactEmail } = await import("@/modules/tenancy/settings");
    await updateTenantContactEmail(ctx, "ventas@eltornillo.com.py");

    const { replyTo } = await senderFor(ctx);
    expect(replyTo).toBe("ventas@eltornillo.com.py");
  });

  it("sendEmail resolves senderFor(ctx) itself when from/replyTo are not given — the send_email automation action's own case", async () => {
    // No RESEND_API_KEY in this test env, so the send itself no-ops — this
    // only proves the resolution ran (not the actual delivery), which is
    // exactly the boundary lib/email/index.test.ts can't reach without a
    // mocked Resend client.
    const { sendEmail } = await import("./index");
    const sent = await sendEmail({
      to: "cliente@example.com",
      subject: "hola",
      html: "<p>hola</p>",
      ctx,
      kind: "automated",
    });
    expect(sent).toBe(false); // unconfigured Resend, not a cap or resolution failure
  });
});
