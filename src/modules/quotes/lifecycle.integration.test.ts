import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The 1E exit criterion, driven end-to-end: quote created → PDF generated →
// public link renders → sent via WhatsApp → status flips to `sent` with a
// `quote_sent` timeline activity (PLAN.md §8).
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("quote lifecycle", () => {
  let db: (typeof import("@/db/client"))["db"];
  let tenancy: typeof import("@/modules/tenancy/service");
  let crm: typeof import("@/modules/crm");
  let quotesModule: typeof import("./index");
  let wa: typeof import("@/modules/whatsapp");
  let worker: typeof import("@/worker");
  let storage: (typeof import("@/lib/storage"))["storage"];
  type TenantContext = import("@/modules/tenancy/types").TenantContext;

  let ctx: TenantContext;
  let contactId: string;
  const uniq = () => Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    ({ db } = await import("@/db/client"));
    tenancy = await import("@/modules/tenancy/service");
    crm = await import("@/modules/crm");
    quotesModule = await import("./index");
    wa = await import("@/modules/whatsapp");
    worker = await import("@/worker");
    ({ storage } = await import("@/lib/storage"));
    await import("./jobs");
    await import("@/modules/whatsapp/jobs");

    const s = uniq();
    const { tenantId, adminUserId } = await tenancy.createTenant({
      name: "Quote Co",
      slug: `quote-${s}`,
      adminEmail: `quote-${s}@x.com`,
      adminPassword: "password123",
      adminName: "Owner",
    });
    ctx = {
      tenantId,
      userId: adminUserId,
      role: "admin",
      isSuperadmin: false,
      impersonatorUserId: null,
    };
    contactId = await crm.createContact(ctx, {
      name: "Cliente Final",
      phone: `+59598${s}`,
    });
    await wa.connectManual(ctx, {
      wabaId: `WABA-${s}`,
      phoneNumberId: `pn-${s}`,
      accessToken: "tok",
    });
  });

  afterAll(async () => {
    wa.resetGraphFetch();
    if (!db) return;
    // Deliberately NOT closing the pool here: db/client.ts is a
    // module-level singleton, and depending on vitest's isolation/pool
    // settings it can be shared across test files run in the same
    // process — closing it here raced with other files still using it
    // (their queries would see a closed pool). The process exits when
    // the whole suite finishes, which reclaims the connection anyway.
  });

  it("runs quote → PDF → public link → WhatsApp send → sent status + activity", async () => {
    const quoteId = await quotesModule.createQuote(ctx, {
      contactId,
      lines: [
        { description: "Servicio A", qty: 1, unitPrice: 250000 },
        { description: "Servicio B", qty: 3, unitPrice: 100000 },
      ],
      discount: 25000,
    });

    const quote = await quotesModule.getQuote(ctx, quoteId);
    expect(quote!.subtotal).toBe(250000 + 3 * 100000);
    expect(quote!.total).toBe(quote!.subtotal - 25000);
    expect(quote!.number).toBe("COT-000001");
    expect(quote!.status).toBe("draft");

    // PDF generated and stored.
    const pdfKey = await quotesModule.generateQuotePdf(ctx, quoteId);
    const bytes = await storage.get(pdfKey);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");

    // Public link resolves the same quote by its bearer token, unauthenticated.
    const publicQuote = await quotesModule.getQuoteByPublicToken(quote!.publicToken);
    expect(publicQuote?.id).toBe(quoteId);
    const publicItems = await quotesModule.listQuoteItems(ctx, quoteId);
    expect(publicItems.length).toBe(2);

    // Mock Graph: media upload then message send.
    let call = 0;
    wa.setGraphFetch(async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ id: "media-1" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ messages: [{ id: "wamid.QUOTE1" }] }),
        { status: 200 },
      );
    });

    // Realistic scenario: the contact already messaged in, opening the 24h
    // free-form window — WhatsApp requires this for any proactive document
    // send that isn't a template (PLAN.md §6.4 applies to quote delivery too).
    // getOrCreateConversationForContact creates the conversation as a side
    // effect of the send, so open it explicitly first via the same helper.
    const conversationId = await wa.getOrCreateConversationForContact(
      ctx,
      contactId,
    );
    const schema = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.conversations)
      .set({ lastInboundAt: new Date() })
      .where(eq(schema.conversations.id, conversationId));

    await quotesModule.sendQuoteViaWhatsApp(ctx, quoteId);

    // Drain: the document send job, then the onDelivered mark-sent job. The
    // jobs table is shared across the whole test run, so budget generously
    // enough to also clear other tests' interleaved jobs (e.g. automation
    // triggers now enqueued on every contact/tag/deal event).
    for (let i = 0; i < 200; i++) {
      const did = await worker.tick("test");
      if (!did) break;
    }

    const afterSend = await quotesModule.getQuote(ctx, quoteId);
    expect(afterSend!.status).toBe("sent");

    const activities = await crm.listContactActivities(ctx, contactId);
    const quoteSent = activities.find((a) => a.type === "quote_sent");
    expect(quoteSent).toBeDefined();
    expect((quoteSent!.payload as { number?: string })?.number).toBe("COT-000001");
  });
});
