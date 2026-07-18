import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Extends the tenant-isolation merge gate (PLAN.md §3.3) to the quotes tables.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("cross-tenant isolation — quotes", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let tenancy: typeof import("@/modules/tenancy/service");
  let crm: typeof import("@/modules/crm");
  let quotesModule: typeof import("./index");
  type TenantContext = import("@/modules/tenancy/types").TenantContext;

  let A: { ctx: TenantContext; contactId: string };
  let B: { ctx: TenantContext; contactId: string };
  const uniq = () => Math.random().toString(36).slice(2, 8);
  const ctxFor = (tenantId: string): TenantContext => ({
    tenantId,
    userId: "u",
    role: "admin",
    isSuperadmin: false,
    impersonatorUserId: null,
  });

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    tenancy = await import("@/modules/tenancy/service");
    crm = await import("@/modules/crm");
    quotesModule = await import("./index");

    for (const [slot, label] of [["A", "qa"], ["B", "qb"]] as const) {
      const s = uniq();
      const { tenantId } = await tenancy.createTenant({
        name: label,
        slug: `${label}-${s}`,
        adminEmail: `${label}-${s}@x.com`,
        adminPassword: "password123",
        adminName: label,
      });
      const ctx = ctxFor(tenantId);
      const contactId = await crm.createContact(ctx, { name: `Contact ${label}` });
      if (slot === "A") A = { ctx, contactId };
      else B = { ctx, contactId };
    }
  });

  afterAll(async () => {
    if (!db) return;
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  it("each tenant gets its own quote numbering starting at COT-000001", async () => {
    const aQuoteId = await quotesModule.createQuote(A.ctx, {
      contactId: A.contactId,
      lines: [{ description: "x", qty: 1, unitPrice: 1000 }],
    });
    const bQuoteId = await quotesModule.createQuote(B.ctx, {
      contactId: B.contactId,
      lines: [{ description: "y", qty: 1, unitPrice: 2000 }],
    });
    const aQuote = await quotesModule.getQuote(A.ctx, aQuoteId);
    const bQuote = await quotesModule.getQuote(B.ctx, bQuoteId);
    expect(aQuote!.number).toBe("COT-000001");
    expect(bQuote!.number).toBe("COT-000001"); // independent sequence per tenant
  });

  it("A cannot read or mutate B's quote", async () => {
    const bQuoteId = await quotesModule.createQuote(B.ctx, {
      contactId: B.contactId,
      lines: [{ description: "secret", qty: 1, unitPrice: 5000 }],
    });

    expect(await quotesModule.getQuote(A.ctx, bQuoteId)).toBeNull();

    const aQuotes = await quotesModule.listQuotes(A.ctx);
    expect(aQuotes.some((q) => q.id === bQuoteId)).toBe(false);

    // A's scoped update can't touch B's row.
    await quotesModule.setQuoteStatus(A.ctx, bQuoteId, "accepted");
    const [row] = await db
      .select()
      .from(schema.quotes)
      .where(eq(schema.quotes.id, bQuoteId));
    expect(row.status).not.toBe("accepted");
  });

  it("products are scoped per tenant", async () => {
    await quotesModule.createProduct(A.ctx, { name: "Prod A", unitPrice: 1000 });
    const aProducts = await quotesModule.listProducts(A.ctx);
    const bProducts = await quotesModule.listProducts(B.ctx);
    expect(aProducts.some((p) => p.name === "Prod A")).toBe(true);
    expect(bProducts.some((p) => p.name === "Prod A")).toBe(false);
  });
});
