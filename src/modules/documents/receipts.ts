import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { documentPayments } from "@/db/schema";
import { env } from "@/lib/config/env";
import { buildSystemTenantContext, type TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getContact } from "@/modules/crm/contacts";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { getDocument } from "./documents";
import { nextDocumentNumber } from "./numbering";
import { renderReceiptPdf } from "./receipt-pdf";

// Recibo (PLAN.md §15.2, §15.8 P6) — a receipt for one `document_payments`
// row. Deliberately not its own `documents` row: it has no items, no quote
// link, no ledger of its own — everything it needs to render already lives
// on the payment and the nota de venta it belongs to.

export function publicReceiptUrl(token: string): string {
  return `${env.APP_URL}/r/${token}`;
}

export function publicReceiptPdfUrl(token: string): string {
  return `${env.APP_URL}/r/${token}/pdf`;
}

/** Assigns the receipt's number and public token the first time anyone asks
 *  for it — a payment nobody ever requests a receipt for never consumes a
 *  `document_sequences` number. Idempotent: a second call returns the same
 *  pair. */
export async function getOrCreateReceipt(
  ctx: TenantContext,
  paymentId: string,
): Promise<{ number: string; token: string } | null> {
  const [payment] = await tenantDb(ctx).select(documentPayments, eq(documentPayments.id, paymentId));
  if (!payment) return null;

  if (payment.receiptNumber && payment.receiptPublicToken) {
    return { number: payment.receiptNumber, token: payment.receiptPublicToken };
  }

  const number = await nextDocumentNumber(ctx, "recibo");
  const token = randomBytes(24).toString("hex");
  await tenantDb(ctx)
    .update(documentPayments)
    .set({ receiptNumber: number, receiptPublicToken: token })
    .where(eq(documentPayments.id, paymentId));

  return { number, token };
}

/**
 * Unauthenticated read for the public view /r/[token] — the token is the
 * secret, same model as the quote and nota de venta links. Platform-wide
 * lookup before any TenantContext exists (documents module's existing
 * exemption, eslint.config.mjs).
 */
export async function getReceiptByPublicToken(token: string) {
  const [payment] = await db
    .select()
    .from(documentPayments)
    .where(eq(documentPayments.receiptPublicToken, token));
  if (!payment) return null;

  const ctx = await buildSystemTenantContext(payment.tenantId);
  if (!ctx) return null;

  const document = await getDocument(ctx, payment.documentId);
  if (!document) return null;

  return { payment, document, ctx };
}

/** Renders on demand, like the quote/nota de venta PDFs — nothing about a
 *  receipt changes after the fact, but rendering fresh avoids a second
 *  storage write for a document this small. */
export async function generateReceiptPdf(ctx: TenantContext, paymentId: string): Promise<Buffer> {
  const [payment] = await tenantDb(ctx).select(documentPayments, eq(documentPayments.id, paymentId));
  if (!payment || !payment.receiptNumber) throw new Error(`receipt_not_found:${paymentId}`);

  const document = await getDocument(ctx, payment.documentId);
  if (!document) throw new Error(`document_not_found:${payment.documentId}`);

  const [contact, tenant] = await Promise.all([
    getContact(ctx, document.contactId),
    getTenant(ctx.tenantId),
  ]);
  if (!contact) throw new Error("contact_not_found");

  const settings = (tenant?.settings ?? {}) as TenantSettings;

  return renderReceiptPdf({
    number: payment.receiptNumber,
    documentNumber: document.number,
    tenantName: tenant?.name ?? "",
    branding: settings.branding ?? {},
    contactName: contact.name,
    contactPhone: contact.phone,
    currency: payment.currency,
    amount: payment.amount,
    method: payment.method,
    reference: payment.reference,
    paidAt: payment.paidAt,
    createdAt: payment.createdAt,
    locale: tenant?.locale,
  });
}
