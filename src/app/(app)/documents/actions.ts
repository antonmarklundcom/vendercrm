"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantContext, requireTenantAdmin } from "@/modules/tenancy/context";
import {
  createDocument,
  updateDraftDocument,
  issueDocument,
  voidDocument,
  recordPayment,
  deletePayment,
  getDocument,
} from "@/modules/documents/documents";
import { sendDocumentToContact, generateDocumentPdf, publicDocumentUrl } from "@/modules/documents/delivery";
import {
  getOrCreateReceipt,
  publicReceiptUrl,
  publicReceiptPdfUrl,
  generateReceiptPdf,
} from "@/modules/documents/receipts";
import { sendDocumentOverWhatsapp, storeDocumentPdf } from "@/modules/renderable-document/delivery";
import { getTranslator } from "@/lib/i18n/translator";
import { sendLinkEmail } from "@/lib/email/document-delivery";
import { createActivity } from "@/modules/crm/activities";
import { getTenant } from "@/modules/tenancy/tenants";

const lineSchema = z.object({
  description: z.string().min(1).max(500),
  qty: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().int().min(0),
  productId: z.string().optional(),
});

function parseLines(formData: FormData) {
  const descriptions = formData.getAll("description").map(String);
  const qtys = formData.getAll("qty").map(String);
  const prices = formData.getAll("unitPrice").map(String);
  const productIds = formData.getAll("productId").map(String);

  return descriptions
    .map((description, i) => ({
      description,
      qty: qtys[i],
      unitPrice: prices[i],
      productId: productIds[i] || undefined,
    }))
    // Blank rows are how the builder represents "not filled in yet".
    .filter((line) => line.description.trim().length > 0);
}

const createDocumentSchema = z.object({
  contactId: z.string().min(1),
  discount: z.coerce.number().int().min(0).optional(),
  dueAt: z.string().optional(),
  notes: z.string().max(5000).optional(),
  items: z.array(lineSchema).min(1),
});

// useActionState-shaped (PLAN.md §10 1R #6): the builder keeps its own line
// items client-side, so the only field worth pointing an inline error at is
// the contact picker — a bad line (empty items array) has no single input to
// sit under and lands in the form-level slot instead.
export type DocumentField = "contactId";

// Now that the amount inputs are inputMode="numeric" and the browser no
// longer blocks the submit, a rejected line reaches the server for the first
// time — and must not borrow the empty-builder message. Not exported: a
// "use server" module may only export async functions.
function lineFailureKey(error: z.ZodError): "itemInvalid" | "discountInvalid" | "itemsRequired" {
  const issues = error.issues;
  if (issues.some((issue) => issue.path[0] === "items" && issue.path.length > 1)) {
    return "itemInvalid";
  }
  if (issues.some((issue) => issue.path[0] === "discount")) return "discountInvalid";
  return "itemsRequired";
}

export type DocumentFormState = {
  error: string | null;
  field: DocumentField | null;
  values: { contactId: string };
};

export async function createDocumentAction(
  _prevState: DocumentFormState,
  formData: FormData,
): Promise<DocumentFormState> {
  const ctx = await requireTenantContext();
  const contactId = String(formData.get("contactId") ?? "");

  const parsed = createDocumentSchema.safeParse({
    contactId,
    discount: formData.get("discount") || 0,
    dueAt: formData.get("dueAt") || undefined,
    notes: formData.get("notes") || undefined,
    items: parseLines(formData),
  });

  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === "contactId")) {
      return { error: "contactRequired", field: "contactId", values: { contactId } };
    }
    return { error: lineFailureKey(parsed.error), field: null, values: { contactId } };
  }

  let document;
  try {
    document = await createDocument(ctx, {
      contactId: parsed.data.contactId,
      discount: parsed.data.discount,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
      notes: parsed.data.notes,
      items: parsed.data.items,
    });
  } catch {
    return { error: "unknown", field: null, values: { contactId } };
  }

  revalidatePath("/documents");
  redirect(`/documents/${document!.id}`);
}

const updateDocumentSchema = z.object({
  documentId: z.string().min(1),
  discount: z.coerce.number().int().min(0).optional(),
  dueAt: z.string().optional(),
  notes: z.string().max(5000).optional(),
  items: z.array(lineSchema).min(1),
});

export type UpdateDocumentFormState = {
  error: string | null;
  values: { contactId: string };
};

export async function updateDraftDocumentAction(
  _prevState: UpdateDocumentFormState,
  formData: FormData,
): Promise<UpdateDocumentFormState> {
  const ctx = await requireTenantContext();
  const documentId = String(formData.get("documentId") ?? "");

  const parsed = updateDocumentSchema.safeParse({
    documentId,
    discount: formData.get("discount") || 0,
    dueAt: formData.get("dueAt") || undefined,
    notes: formData.get("notes") || undefined,
    items: parseLines(formData),
  });

  if (!parsed.success) {
    return { error: lineFailureKey(parsed.error), values: { contactId: "" } };
  }

  try {
    await updateDraftDocument(ctx, parsed.data.documentId, {
      discount: parsed.data.discount,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
      notes: parsed.data.notes,
      items: parsed.data.items,
    });
  } catch {
    return { error: "unknown", values: { contactId: "" } };
  }

  revalidatePath(`/documents/${parsed.data.documentId}`);
  redirect(`/documents/${parsed.data.documentId}`);
}

// Hidden-id-only actions: there's no field a user fills in for the server to
// reject, so a bad submission (a tampered id) fails silently instead of
// crashing — safeParse instead of parse, no state to render.
export async function issueDocumentAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = z.string().min(1).safeParse(formData.get("documentId"));
  if (!parsed.success) return;
  await issueDocument(ctx, parsed.data);
  revalidatePath(`/documents/${parsed.data}`);
}

const voidDocumentSchema = z.object({
  documentId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

export type VoidDocumentFormState = {
  error: string | null;
  values: { reason: string };
};

// Admin-only, unlike issue/record-payment above: voiding cancels a sale that
// the customer already holds a link to, and it is not undoable. Agents sell
// (§3.2), admins reverse. The void itself writes an auditLog row from the
// documents module, so who cancelled what — and why — survives the action.
export async function voidDocumentAction(
  _prevState: VoidDocumentFormState,
  formData: FormData,
): Promise<VoidDocumentFormState> {
  const ctx = await requireTenantAdmin();
  const documentId = String(formData.get("documentId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  const parsed = voidDocumentSchema.safeParse({ documentId, reason });
  if (!parsed.success) {
    return { error: "voidReasonRequired", values: { reason } };
  }

  try {
    await voidDocument(ctx, parsed.data.documentId, parsed.data.reason);
  } catch {
    return { error: "unknown", values: { reason } };
  }

  revalidatePath(`/documents/${parsed.data.documentId}`);
  return { error: null, values: { reason: "" } };
}

export async function sendDocumentAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = z.string().min(1).safeParse(formData.get("documentId"));
  if (!parsed.success) return;
  await sendDocumentToContact(ctx, parsed.data);
  revalidatePath(`/documents/${parsed.data}`);
}

/** "Enviar por email" (PLAN.md §15.1, §15.8 P4) — same shape as
 *  sendQuoteByEmailAction: the public link and PDF, no status/activity type
 *  owned by modules/documents (P6's Owns column). */
export async function sendDocumentByEmailAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = z.string().min(1).safeParse(formData.get("documentId"));
  if (!parsed.success) return;

  const document = await getDocument(ctx, parsed.data);
  if (!document) return;

  const [pdf, tenant] = await Promise.all([
    generateDocumentPdf(ctx, document.id),
    getTenant(ctx.tenantId),
  ]);
  const t = await getTranslator(tenant?.locale, "pdf.notaVenta");
  const url = publicDocumentUrl(document.publicToken);

  const result = await sendLinkEmail(ctx, {
    contactId: document.contactId,
    subject: `${t("caption")} ${document.number}`,
    lines: [`${t("caption")} ${document.number}.`],
    linkLabel: url,
    linkUrl: url,
    attachment: { filename: `${document.number}.pdf`, content: pdf },
  });

  if (result.sent) {
    await createActivity(ctx, {
      contactId: document.contactId,
      dealId: document.dealId ?? undefined,
      type: "system",
      payload: { kind: "document_emailed", documentId: document.id, number: document.number },
      userId: ctx.userId,
    });
  }

  revalidatePath(`/documents/${parsed.data}`);
}

const recordPaymentSchema = z.object({
  documentId: z.string().min(1),
  amount: z.coerce.number().int().min(1),
  method: z.enum(["transfer", "cash", "card", "check", "other"]).optional(),
  reference: z.string().max(200).optional(),
  paidAt: z.string().optional(),
  notes: z.string().max(500).optional(),
});

export type RecordPaymentField = "amount";

export type RecordPaymentFormState = {
  error: string | null;
  field: RecordPaymentField | null;
  values: Record<string, string>;
};

export async function recordPaymentAction(
  _prevState: RecordPaymentFormState,
  formData: FormData,
): Promise<RecordPaymentFormState> {
  const ctx = await requireTenantContext();
  const values = Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  const parsed = recordPaymentSchema.safeParse({
    documentId: formData.get("documentId"),
    amount: formData.get("amount"),
    method: formData.get("method") || undefined,
    reference: formData.get("reference") || undefined,
    paidAt: formData.get("paidAt") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "amount") {
      return { error: "amountInvalid", field: "amount", values };
    }
    return { error: "unknown", field: null, values };
  }

  try {
    await recordPayment(ctx, parsed.data.documentId, {
      amount: parsed.data.amount,
      method: parsed.data.method,
      reference: parsed.data.reference,
      paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : undefined,
      notes: parsed.data.notes,
    });
  } catch {
    return { error: "unknown", field: null, values };
  }

  revalidatePath(`/documents/${parsed.data.documentId}`);
  return { error: null, field: null, values: {} };
}

const deletePaymentSchema = z.object({
  documentId: z.string().min(1),
  paymentId: z.string().min(1),
});

// Admin-only for the same reason as voiding: deleting a payment rewrites the
// ledger a document's balance is computed from. Audited in the module.
export async function deletePaymentAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = deletePaymentSchema.safeParse({
    documentId: formData.get("documentId"),
    paymentId: formData.get("paymentId"),
  });
  if (!parsed.success) return;
  await deletePayment(ctx, parsed.data.documentId, parsed.data.paymentId);
  revalidatePath(`/documents/${parsed.data.documentId}`);
}

/** "Recibo" beside a payment (PLAN.md §15.2, §15.8 P6) — assigns the
 *  number/token on first visit, then sends the rep straight to the public
 *  page (the same one a customer would see if handed the link). */
export async function viewReceiptAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const paymentId = String(formData.get("paymentId") ?? "");
  if (!paymentId) return;

  const receipt = await getOrCreateReceipt(ctx, paymentId);
  if (!receipt) return;

  redirect(publicReceiptUrl(receipt.token));
}

/** "Enviar por WhatsApp" on the receipt — reuses sendDocumentOverWhatsapp,
 *  same as the quote and nota de venta sends. No status to advance (a
 *  receipt has none); a failed send just leaves the public link as the
 *  fallback, same as everywhere else this helper is used. */
export async function sendReceiptOverWhatsappAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const paymentId = String(formData.get("paymentId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");
  if (!paymentId || !documentId) return;

  const receipt = await getOrCreateReceipt(ctx, paymentId);
  const document = await getDocument(ctx, documentId);
  if (!receipt || !document) return;

  const [pdf, tenant] = await Promise.all([
    generateReceiptPdf(ctx, paymentId),
    getTenant(ctx.tenantId),
  ]);
  const t = await getTranslator(tenant?.locale, "pdf.recibo");
  await storeDocumentPdf(ctx, { kind: "receipts", id: paymentId, pdf });

  await sendDocumentOverWhatsapp(ctx, {
    contactId: document.contactId,
    link: publicReceiptPdfUrl(receipt.token),
    filename: `${receipt.number}.pdf`,
    caption: `${t("title")} ${receipt.number}`,
  });

  revalidatePath(`/documents/${documentId}`);
}
