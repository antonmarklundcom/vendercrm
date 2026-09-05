import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { documentItems, documentPayments, documents } from "@/db/schema";
import { newId } from "@/lib/ids";
import { computeLineTotals, type LineInput } from "@/lib/money";
import { buildSystemTenantContext, type TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { writeAuditLog } from "@/modules/tenancy/audit";
import { createActivity } from "@/modules/crm/activities";
import { getQuote, listQuoteItems } from "@/modules/quotes/quotes";
import { documentEvents } from "./events";
import { nextDocumentNumber } from "./numbering";
import {
  balanceOf,
  paymentStateOf,
  type DocumentStatus,
  type DocumentType,
  type PaymentState,
} from "./types";

// Non-fiscal commercial documents — notas de venta (PLAN.md §10 1Q).
//
// The invariant this module exists to enforce: **an issued document does not
// change.** A quote is an offer and may be edited freely; a nota de venta is
// the record of an agreed sale, and a customer holding the PDF must be able
// to trust that the copy in the system says the same thing. Everything that
// could mutate an issued document is refused here, in the service layer,
// rather than left to the UI to remember.

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentItemRow = typeof documentItems.$inferSelect;

export type CreateDocumentInput = {
  contactId: string;
  dealId?: string;
  type?: DocumentType;
  currency?: string;
  discount?: number;
  dueAt?: Date;
  notes?: string;
  items: LineInput[];
};

function publicToken(): string {
  return randomBytes(24).toString("hex");
}

export async function createDocument(ctx: TenantContext, input: CreateDocumentInput) {
  if (input.items.length === 0) {
    throw new Error("La nota de venta necesita al menos un ítem");
  }

  const type = input.type ?? "nota_venta";
  const { lines, subtotal, discount, total } = computeLineTotals(input.items, input.discount);
  const id = newId();
  const number = await nextDocumentNumber(ctx, type);

  await tenantDb(ctx)
    .insert(documents)
    .values({
      id,
      type,
      number,
      contactId: input.contactId,
      dealId: input.dealId,
      status: "draft",
      currency: input.currency ?? "PYG",
      subtotal,
      discount,
      total,
      dueAt: input.dueAt,
      notes: input.notes,
      publicToken: publicToken(),
    });

  await insertItems(ctx, id, lines);
  return getDocument(ctx, id);
}

/**
 * Quote → nota de venta. Copies the lines **by value**, not by reference:
 * the quote stays independently editable afterwards, and a later change to
 * it can never rewrite a document a customer already holds.
 */
export async function createDocumentFromQuote(
  ctx: TenantContext,
  quoteId: string,
  overrides: { dueAt?: Date; notes?: string } = {},
) {
  const quote = await getQuote(ctx, quoteId);
  if (!quote) throw new Error(`Presupuesto ${quoteId} no encontrado`);

  const items = await listQuoteItems(ctx, quote.id);
  if (items.length === 0) throw new Error("El presupuesto no tiene ítems");

  const type: DocumentType = "nota_venta";
  const id = newId();
  const number = await nextDocumentNumber(ctx, type);

  // Totals come from the quote as stored rather than being recomputed, so
  // the document says exactly what the customer already agreed to — even if
  // the arithmetic rules were to change later.
  await tenantDb(ctx)
    .insert(documents)
    .values({
      id,
      type,
      number,
      contactId: quote.contactId,
      dealId: quote.dealId,
      quoteId: quote.id,
      status: "draft",
      currency: quote.currency,
      subtotal: quote.subtotal,
      discount: quote.discount,
      total: quote.total,
      dueAt: overrides.dueAt,
      notes: overrides.notes ?? quote.notes,
      publicToken: publicToken(),
    });

  await insertItems(
    ctx,
    id,
    items.map((item) => ({
      productId: item.productId ?? undefined,
      description: item.description,
      qty: item.qty,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
  );

  return getDocument(ctx, id);
}

async function insertItems(
  ctx: TenantContext,
  documentId: string,
  lines: Array<LineInput & { lineTotal: number }>,
) {
  let position = 0;
  for (const line of lines) {
    await tenantDb(ctx)
      .insert(documentItems)
      .values({
        id: newId(),
        documentId,
        productId: line.productId,
        description: line.description,
        qty: line.qty,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        position: position++,
      });
  }
}

export async function getDocument(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(documents, eq(documents.id, id));
  return row ?? null;
}

export async function listDocuments(ctx: TenantContext) {
  const rows = await tenantDb(ctx).select(documents);
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function listDocumentsForContact(ctx: TenantContext, contactId: string) {
  const rows = await tenantDb(ctx).select(documents, eq(documents.contactId, contactId));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Used by the quote detail page to offer "convertir" only once per quote. */
export async function getDocumentByQuote(ctx: TenantContext, quoteId: string) {
  const [row] = await tenantDb(ctx).select(documents, eq(documents.quoteId, quoteId));
  return row ?? null;
}

export async function listDocumentItems(ctx: TenantContext, documentId: string) {
  const rows = await tenantDb(ctx).select(
    documentItems,
    eq(documentItems.documentId, documentId),
  );
  return rows.sort((a, b) => a.position - b.position);
}

/**
 * Replaces the lines of a **draft** document. Refused once issued — that is
 * the whole point of the status.
 */
export async function updateDraftDocument(
  ctx: TenantContext,
  id: string,
  input: { items: LineInput[]; discount?: number; dueAt?: Date; notes?: string },
) {
  const document = await requireDraft(ctx, id);
  if (input.items.length === 0) {
    throw new Error("La nota de venta necesita al menos un ítem");
  }

  const { lines, subtotal, discount, total } = computeLineTotals(input.items, input.discount);

  await tenantDb(ctx).delete(documentItems, eq(documentItems.documentId, document.id));
  await insertItems(ctx, document.id, lines);

  await tenantDb(ctx)
    .update(documents)
    .set({ subtotal, discount, total, dueAt: input.dueAt, notes: input.notes })
    .where(eq(documents.id, document.id));

  return getDocument(ctx, document.id);
}

/**
 * Issues the document — the one-way door. After this the number, the lines
 * and the totals are fixed, and a `document_issued` activity records it on
 * the contact timeline.
 */
export async function issueDocument(ctx: TenantContext, id: string) {
  const document = await requireDraft(ctx, id);

  await tenantDb(ctx)
    .update(documents)
    .set({ status: "issued", issuedAt: new Date() })
    .where(eq(documents.id, document.id));

  await createActivity(ctx, {
    contactId: document.contactId,
    dealId: document.dealId ?? undefined,
    type: "system",
    payload: {
      kind: "document_issued",
      documentId: document.id,
      number: document.number,
      total: document.total,
      currency: document.currency,
    },
    userId: ctx.userId,
  });

  return getDocument(ctx, document.id);
}

/**
 * Voids a document. Refused while payments are recorded against it: money
 * that came in has to be accounted for, and silently detaching it from its
 * document is how a ledger stops reconciling. Delete the payments first if
 * they were recorded in error.
 */
export async function voidDocument(ctx: TenantContext, id: string, reason: string) {
  const document = await getDocument(ctx, id);
  if (!document) throw new Error(`Nota de venta ${id} no encontrada`);
  if (document.status === "void") return document;

  const paid = await amountPaid(ctx, id);
  if (paid > 0) {
    throw new Error(
      "No se puede anular una nota de venta con pagos registrados — eliminá los pagos primero",
    );
  }

  await tenantDb(ctx)
    .update(documents)
    .set({ status: "void", voidedAt: new Date(), voidReason: reason.slice(0, 500) })
    .where(eq(documents.id, id));

  // Voiding cancels a sale the customer already holds a link to and cannot be
  // undone, so it leaves a trail (§3.2): who did it, under whose session if
  // impersonated, and against which document number.
  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    impersonatorUserId: ctx.impersonatorUserId,
    action: "document.void",
    entity: "document",
    entityId: id,
    payload: { number: document.number, total: document.total, reason: reason.slice(0, 500) },
  });

  return getDocument(ctx, id);
}

export async function setDocumentPdfKey(ctx: TenantContext, id: string, key: string) {
  await tenantDb(ctx).update(documents).set({ pdfStorageKey: key }).where(eq(documents.id, id));
}

async function requireDraft(ctx: TenantContext, id: string): Promise<DocumentRow> {
  const document = await getDocument(ctx, id);
  if (!document) throw new Error(`Nota de venta ${id} no encontrada`);
  if (document.status !== "draft") {
    throw new Error(
      `La nota de venta ${document.number} ya fue emitida y no se puede modificar`,
    );
  }
  return document;
}

// --- Payment ledger ------------------------------------------------------

export async function amountPaid(ctx: TenantContext, documentId: string): Promise<number> {
  const rows = await tenantDb(ctx).select(
    documentPayments,
    eq(documentPayments.documentId, documentId),
  );
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

export type DocumentTotals = {
  total: number;
  amountPaid: number;
  balance: number;
  state: PaymentState;
};

/** The derived money view — what every UI should show, never raw columns. */
export async function getDocumentTotals(
  ctx: TenantContext,
  documentId: string,
): Promise<DocumentTotals | null> {
  const document = await getDocument(ctx, documentId);
  if (!document) return null;

  const paid = await amountPaid(ctx, documentId);
  return {
    total: document.total,
    amountPaid: paid,
    balance: balanceOf(document.total, paid),
    state: paymentStateOf(document.status as DocumentStatus, document.total, paid),
  };
}

export type RecordPaymentInput = {
  amount: number;
  method?: "transfer" | "cash" | "card" | "check" | "other";
  reference?: string;
  paidAt?: Date;
  notes?: string;
};

/**
 * Records money received. Only against an issued document: taking payment
 * for a draft means the draft was really an agreement, and letting the lines
 * still move underneath recorded money is exactly the drift this module
 * refuses.
 */
export async function recordPayment(
  ctx: TenantContext,
  documentId: string,
  input: RecordPaymentInput,
) {
  const document = await getDocument(ctx, documentId);
  if (!document) throw new Error(`Nota de venta ${documentId} no encontrada`);
  if (document.status !== "issued") {
    throw new Error("Solo se pueden registrar pagos de una nota de venta emitida");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("El pago debe ser mayor que cero");
  }

  // Read before writing, so "did this payment settle the document?" can be
  // answered exactly once (§15.5 J1: `document_paid` fires once, when the
  // ledger reaches the total). A second payment on an already-settled
  // document, or one that leaves a balance, emits nothing.
  const paidBefore = await amountPaid(ctx, documentId);

  const id = newId();
  await tenantDb(ctx)
    .insert(documentPayments)
    .values({
      id,
      documentId,
      amount: Math.floor(input.amount),
      currency: document.currency,
      method: input.method ?? "cash",
      reference: input.reference,
      paidAt: input.paidAt ?? new Date(),
      recordedByUserId: ctx.userId,
      notes: input.notes,
    });

  const totals = await getDocumentTotals(ctx, documentId);

  if (paidBefore < document.total && (totals?.amountPaid ?? 0) >= document.total) {
    await documentEvents.emit("document.paid", {
      tenantId: ctx.tenantId,
      contactId: document.contactId,
      documentId: document.id,
      dealId: document.dealId ?? null,
      number: document.number,
      total: document.total,
      currency: document.currency,
    });
  }

  return totals;
}

export async function listPayments(ctx: TenantContext, documentId: string) {
  const rows = await tenantDb(ctx).select(
    documentPayments,
    eq(documentPayments.documentId, documentId),
  );
  return rows.sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
}

export async function deletePayment(ctx: TenantContext, documentId: string, paymentId: string) {
  // Read before deleting: the amount is the only thing worth auditing here,
  // and once the row is gone there is nothing left to record. A paymentId
  // that doesn't belong to this document (or this tenant) simply isn't found
  // and nothing is logged — the delete below is a no-op in that case too.
  const [payment] = await tenantDb(ctx).select(
    documentPayments,
    and(eq(documentPayments.id, paymentId), eq(documentPayments.documentId, documentId)),
  );

  await tenantDb(ctx).delete(
    documentPayments,
    and(eq(documentPayments.id, paymentId), eq(documentPayments.documentId, documentId)),
  );

  if (payment) {
    // Deleting a payment rewrites the ledger a document's balance is computed
    // from — destructive and admin-only, so it is audited like a void (§3.2).
    await writeAuditLog({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      impersonatorUserId: ctx.impersonatorUserId,
      action: "document.payment_deleted",
      entity: "document",
      entityId: documentId,
      payload: { paymentId, amount: payment.amount, method: payment.method },
    });
  }

  return getDocumentTotals(ctx, documentId);
}

// --- Public token lookup -------------------------------------------------

/**
 * Resolves the public read-only link /d/[token]. Runs before any
 * TenantContext can exist — structurally the same unauthenticated lookup as
 * the quote token (§8), which is why this module carries the same raw-`db`
 * lint exemption. Everything after the tenant is known goes through
 * tenantDb.
 */
export async function getDocumentByPublicToken(token: string) {
  if (token.length < 32) return null;

  const [document] = await db.select().from(documents).where(eq(documents.publicToken, token));
  if (!document) return null;
  // A voided document's link stops resolving — the customer should not keep
  // seeing a cancelled sale as if it stood.
  if (document.status === "void") return null;

  const ctx = await buildSystemTenantContext(document.tenantId);
  if (!ctx) return null;

  const [items, paid] = await Promise.all([
    listDocumentItems(ctx, document.id),
    amountPaid(ctx, document.id),
  ]);

  return {
    document,
    items,
    amountPaid: paid,
    balance: balanceOf(document.total, paid),
    state: paymentStateOf(document.status as DocumentStatus, document.total, paid),
    ctx,
  };
}
