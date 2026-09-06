import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The sweep itself needs a real MySQL — it walks every tenant through
// tenantDb, exactly like crm/task-reminders.ts's daily job.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("expireQuotes (MySQL)", () => {
  let db: (typeof import("@/db/client"))["db"];
  let newId: (typeof import("@/lib/ids"))["newId"];
  let createTenant: (typeof import("@/modules/tenancy/tenants"))["createTenant"];
  let buildSystemTenantContext: (typeof import("@/modules/tenancy/context"))["buildSystemTenantContext"];
  let createContact: (typeof import("@/modules/crm/contacts"))["createContact"];
  let createQuote: (typeof import("./quotes"))["createQuote"];
  let setQuoteStatus: (typeof import("./quotes"))["setQuoteStatus"];
  let getQuote: (typeof import("./quotes"))["getQuote"];
  let expireQuotes: (typeof import("./expiry"))["expireQuotes"];

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  const superadmin = { userId: "sa-test", impersonatorUserId: null } as const;

  let ctx: TenantContext;
  let contactId: string;

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    ({ newId } = await import("@/lib/ids"));
    ({ createTenant } = await import("@/modules/tenancy/tenants"));
    ({ buildSystemTenantContext } = await import("@/modules/tenancy/context"));
    ({ createContact } = await import("@/modules/crm/contacts"));
    ({ createQuote, setQuoteStatus, getQuote } = await import("./quotes"));
    ({ expireQuotes } = await import("./expiry"));

    const tenant = await createTenant(superadmin, { name: "Expiry Co", slug: `expiry-${newId()}` });
    ctx = (await buildSystemTenantContext(tenant!.id))!;
    contactId = (await createContact(ctx, {
      name: "Cliente Vencido",
      phone: `0981${newId().slice(0, 6)}`,
    }))!.id;
  });

  afterAll(async () => {
    if (!db) return;
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  async function sentQuote(validUntil: Date | undefined) {
    const quote = await createQuote(ctx, {
      contactId,
      validUntil,
      items: [{ description: "Trabajo", qty: 1, unitPrice: 200000 }],
    });
    await setQuoteStatus(ctx, quote!.id, "sent");
    return quote!.id;
  }

  it("moves a sent quote past its validUntil to expired", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const overdueId = await sentQuote(new Date("2026-05-01T00:00:00Z"));

    const count = await expireQuotes(now);
    expect(count).toBeGreaterThanOrEqual(1);

    const overdue = await getQuote(ctx, overdueId);
    expect(overdue!.status).toBe("expired");
  });

  it("leaves a sent quote alone before its validUntil, and one with no validUntil at all", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const notYetId = await sentQuote(new Date("2027-01-01T00:00:00Z"));
    const evergreenId = await sentQuote(undefined);

    await expireQuotes(now);

    expect((await getQuote(ctx, notYetId))!.status).toBe("sent");
    expect((await getQuote(ctx, evergreenId))!.status).toBe("sent");
  });

  it("never touches a quote that isn't in sent status", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const draft = await createQuote(ctx, {
      contactId,
      validUntil: new Date("2026-01-01T00:00:00Z"),
      items: [{ description: "Borrador vencido", qty: 1, unitPrice: 100000 }],
    });

    await expireQuotes(now);

    expect((await getQuote(ctx, draft!.id))!.status).toBe("draft");
  });
});
