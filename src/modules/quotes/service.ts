import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { quotes, quoteItems, quoteSequences } from "@/db/schema";
import { newId } from "@/lib/ids";
import { tenantDb } from "@/modules/tenancy/db";
import type { TenantContext } from "@/modules/tenancy/types";
import { addActivity } from "@/modules/crm/activities";

export type QuoteLineInput = {
  productId?: string;
  description: string;
  qty: number;
  unitPrice: number;
};

export type Quote = typeof quotes.$inferSelect;
export type QuoteItem = typeof quoteItems.$inferSelect;

// Atomically claims the next per-tenant sequence number and formats it as
// "COT-000123" (PLAN.md §8). Runs inside the caller's transaction so the
// counter and the quote row that consumes it move together.
async function nextQuoteNumber(tdb: ReturnType<typeof tenantDb>): Promise<string> {
  const [existing] = await tdb
    .select(quoteSequences)
    .for("update");

  let next: number;
  if (existing) {
    next = existing.nextNumber;
    await tdb.update(
      quoteSequences,
      { nextNumber: next + 1 },
      eq(quoteSequences.tenantId, tdb.tenantId),
    );
  } else {
    next = 1;
    await tdb.insert(quoteSequences, { nextNumber: 2 } as never);
  }
  return `COT-${String(next).padStart(6, "0")}`;
}

function computeTotals(lines: QuoteLineInput[], discount: number) {
  const subtotal = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  const total = Math.max(0, subtotal - discount);
  return { subtotal, total };
}

export async function createQuote(
  ctx: TenantContext,
  input: {
    contactId: string;
    dealId?: string | null;
    lines: QuoteLineInput[];
    discount?: number;
    currency?: string;
    validUntil?: Date | null;
    notes?: string | null;
  },
): Promise<string> {
  const discount = input.discount ?? 0;
  const { subtotal, total } = computeTotals(input.lines, discount);
  const quoteId = newId();

  await tenantDb(ctx).transaction(async (tdb) => {
    const number = await nextQuoteNumber(tdb);
    await tdb.insert(quotes, {
      id: quoteId,
      contactId: input.contactId,
      dealId: input.dealId ?? null,
      number,
      status: "draft",
      currency: input.currency ?? "PYG",
      subtotal,
      discount,
      total,
      validUntil: input.validUntil ?? null,
      notes: input.notes ?? null,
      publicToken: randomBytes(24).toString("hex"),
    });
    await tdb.insertMany(
      quoteItems,
      input.lines.map((line, i) => ({
        id: newId(),
        quoteId,
        productId: line.productId ?? null,
        description: line.description,
        qty: line.qty,
        unitPrice: line.unitPrice,
        lineTotal: line.qty * line.unitPrice,
        position: i,
      })),
    );
  });

  return quoteId;
}

export async function getQuote(ctx: TenantContext, quoteId: string) {
  const [row] = await tenantDb(ctx).select(quotes, eq(quotes.id, quoteId));
  return row ?? null;
}

export async function listQuoteItems(ctx: TenantContext, quoteId: string) {
  return tenantDb(ctx)
    .select(quoteItems, eq(quoteItems.quoteId, quoteId))
    .orderBy(asc(quoteItems.position));
}

export async function listQuotesForContact(ctx: TenantContext, contactId: string) {
  return tenantDb(ctx)
    .select(quotes, eq(quotes.contactId, contactId))
    .orderBy(asc(quotes.createdAt));
}

export async function listQuotes(ctx: TenantContext) {
  return tenantDb(ctx).select(quotes).orderBy(asc(quotes.createdAt));
}

export async function setQuoteStatus(
  ctx: TenantContext,
  quoteId: string,
  status: Quote["status"],
): Promise<void> {
  await tenantDb(ctx).update(quotes, { status }, eq(quotes.id, quoteId));
}

export async function setQuotePdfKey(
  ctx: TenantContext,
  quoteId: string,
  pdfStorageKey: string,
): Promise<void> {
  await tenantDb(ctx).update(quotes, { pdfStorageKey }, eq(quotes.id, quoteId));
}

// Marks the quote sent and records a `quote_sent` timeline activity
// (PLAN.md §5, §8). Called after the PDF has actually been delivered.
export async function markQuoteSent(
  ctx: TenantContext,
  quoteId: string,
): Promise<void> {
  const quote = await getQuote(ctx, quoteId);
  if (!quote) throw new Error("Presupuesto no encontrado");
  await setQuoteStatus(ctx, quoteId, "sent");
  await addActivity(ctx, {
    contactId: quote.contactId,
    dealId: quote.dealId,
    type: "quote_sent",
    payload: { quoteId, number: quote.number, total: quote.total },
  });
}

// Unauthenticated lookup by public token for the /q/[token] view. Deliberately
// NOT scoped through tenantDb — there is no tenant context on this request,
// and the bearer token itself (globally unique) is the credential, exactly
// like the WhatsApp webhook's phone_number_id routing (PLAN.md §3.3).
export async function getQuoteByPublicToken(token: string) {
  const [row] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.publicToken, token))
    .limit(1);
  return row ?? null;
}
