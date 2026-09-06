import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Needs a real MySQL — the unique index on quote_acceptances.quote_id is
// exactly what backstops the "decided exactly once" guarantee under test.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("quote public accept/reject (MySQL)", () => {
  let db: (typeof import("@/db/client"))["db"];
  let schema: typeof import("@/db/schema");
  let newId: (typeof import("@/lib/ids"))["newId"];
  let createTenant: (typeof import("@/modules/tenancy/tenants"))["createTenant"];
  let buildSystemTenantContext: (typeof import("@/modules/tenancy/context"))["buildSystemTenantContext"];
  let createContact: (typeof import("@/modules/crm/contacts"))["createContact"];
  let createQuote: (typeof import("./quotes"))["createQuote"];
  let setQuoteStatus: (typeof import("./quotes"))["setQuoteStatus"];
  let decideQuote: (typeof import("./public"))["decideQuote"];
  let getQuoteDecision: (typeof import("./public"))["getQuoteDecision"];

  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  const superadmin = { userId: "sa-test", impersonatorUserId: null } as const;

  let ctx: TenantContext;
  let contactId: string;

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    schema = await import("@/db/schema");
    ({ newId } = await import("@/lib/ids"));
    ({ createTenant } = await import("@/modules/tenancy/tenants"));
    ({ buildSystemTenantContext } = await import("@/modules/tenancy/context"));
    ({ createContact } = await import("@/modules/crm/contacts"));
    ({ createQuote, setQuoteStatus } = await import("./quotes"));
    ({ decideQuote, getQuoteDecision } = await import("./public"));

    // Wires quoteEvents -> automations/triggers.ts -> the `automation.trigger`
    // job, the same side-effect import the worker does at boot (jobs.ts).
    await import("@/modules/automations/jobs");

    const tenant = await createTenant(superadmin, {
      name: "Decision Co",
      slug: `decision-${newId()}`,
    });
    ctx = (await buildSystemTenantContext(tenant!.id))!;
    contactId = (await createContact(ctx, {
      name: "Cliente Decisión",
      phone: `0981${newId().slice(0, 6)}`,
    }))!.id;
  });

  afterAll(async () => {
    if (!db) return;
    const pool = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
    await pool.end();
  });

  async function newSentQuote() {
    const quote = await createQuote(ctx, {
      contactId,
      items: [{ description: "Servicio", qty: 1, unitPrice: 500000 }],
    });
    await setQuoteStatus(ctx, quote!.id, "sent");
    const [row] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, quote!.id));
    return row;
  }

  it("accepting a sent quote sets its status, records the decision and fires quote_accepted", async () => {
    const quote = await newSentQuote();

    const outcome = await decideQuote(quote.publicToken, {
      decision: "accepted",
      name: "Ana Cliente",
      comment: "Todo bien",
    });
    expect(outcome.ok).toBe(true);

    const [updated] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, quote.id));
    expect(updated.status).toBe("accepted");

    const decision = await getQuoteDecision(quote.id, ctx.tenantId);
    expect(decision?.decision).toBe("accepted");
    expect(decision?.name).toBe("Ana Cliente");

    // The listener in modules/automations/triggers.ts turns the emitted
    // `quote.accepted` event into a queued `automation.trigger` job — proof
    // the trigger actually fired, without needing the worker running.
    const fired = await db
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.type, "automation.trigger"), eq(schema.jobs.tenantId, ctx.tenantId)));
    expect(
      fired.some((job) => (job.payload as { triggerType?: string }).triggerType === "quote_accepted"),
    ).toBe(true);
  });

  it("refuses a second decision on the same quote, whichever direction", async () => {
    const quote = await newSentQuote();

    const first = await decideQuote(quote.publicToken, { decision: "rejected", name: "Primero" });
    expect(first.ok).toBe(true);

    const second = await decideQuote(quote.publicToken, { decision: "accepted", name: "Segundo" });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("alreadyDecided");

    // The first decision stands — a rejected quote never flips to accepted.
    const [row] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, quote.id));
    expect(row.status).toBe("rejected");
    const decision = await getQuoteDecision(quote.id, ctx.tenantId);
    expect(decision?.name).toBe("Primero");
  });

  it("refuses a decision on a quote that was never sent, or an unknown token", async () => {
    const draft = await createQuote(ctx, {
      contactId,
      items: [{ description: "Borrador", qty: 1, unitPrice: 100000 }],
    });
    const [row] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, draft!.id));

    const outcome = await decideQuote(row.publicToken, { decision: "accepted", name: "Nadie" });
    expect(outcome).toEqual({ ok: false, reason: "notSent" });

    const invalid = await decideQuote("not-a-real-token", { decision: "accepted", name: "Nadie" });
    expect(invalid).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a decision on an expired quote", async () => {
    const quote = await newSentQuote();
    await setQuoteStatus(ctx, quote.id, "expired");

    const outcome = await decideQuote(quote.publicToken, { decision: "accepted", name: "Tarde" });
    expect(outcome).toEqual({ ok: false, reason: "expired" });
  });
});
