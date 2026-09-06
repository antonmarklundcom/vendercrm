// Shared types for non-fiscal documents (PLAN.md §10 1Q). Kept free of the
// db client so the pure helpers below can be unit-tested without a
// configured environment.

export const DOCUMENT_TYPES = ["nota_venta"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * Numbering-only kinds (§15.8 P6): `document_sequences` is keyed by
 * (tenant, doc_type) generically, so a receipt takes a number the same way
 * a nota de venta does without needing a row — or an enum entry — on the
 * `documents` table itself (it renders straight off `document_payments`).
 */
export const NUMBERED_DOCUMENT_TYPES = [...DOCUMENT_TYPES, "recibo"] as const;
export type NumberedDocumentType = (typeof NUMBERED_DOCUMENT_TYPES)[number];

export type DocumentStatus = "draft" | "issued" | "void";

export const PAYMENT_METHODS = ["transfer", "cash", "card", "check", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Payment state is derived, never stored (see the schema comment on
 * `documents.status`). Voided documents owe nothing regardless of what the
 * ledger says — though voiding is refused while payments exist, so in
 * practice a void document has an empty ledger.
 */
export type PaymentState = "unpaid" | "partial" | "paid" | "void";

export function paymentStateOf(
  status: DocumentStatus,
  total: number,
  amountPaid: number,
): PaymentState {
  if (status === "void") return "void";
  if (amountPaid <= 0) return "unpaid";
  // `>=` rather than `===`: an overpayment is still fully paid, and a
  // document that reads "partial" while the customer has paid more than the
  // total would be actively misleading to a rep chasing it.
  if (amountPaid >= total) return "paid";
  return "partial";
}

export function balanceOf(total: number, amountPaid: number): number {
  // Never negative — an overpayment leaves nothing owed, and a negative
  // balance rendered on a document reads as a debt owed *to* the customer,
  // which this document type does not represent.
  return Math.max(total - amountPaid, 0);
}
