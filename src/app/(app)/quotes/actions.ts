"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantContext } from "@/modules/tenancy/context";
import { createQuote, duplicateQuote, getQuote, setQuoteStatus } from "@/modules/quotes/quotes";
import { sendQuote, generateQuotePdf, publicQuoteUrl } from "@/modules/quotes/delivery";
import { createDocumentFromQuote } from "@/modules/documents/documents";
import { sendLinkEmail } from "@/lib/email/document-delivery";
import { createActivity } from "@/modules/crm/activities";
import { getTenant } from "@/modules/tenancy/tenants";
import { getTranslator } from "@/lib/i18n/translator";

const lineSchema = z.object({
  description: z.string().min(1).max(500),
  qty: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().int().min(0),
  productId: z.string().optional(),
});

const createQuoteSchema = z.object({
  contactId: z.string().min(1),
  dealId: z.string().optional(),
  discount: z.coerce.number().int().min(0).optional(),
  validUntil: z.string().optional(),
  notes: z.string().max(5000).optional(),
  items: z.array(lineSchema).min(1),
});

// useActionState-shaped (PLAN.md §10 1R #6): the builder keeps its own line
// items client-side, so the only field worth pointing an inline error at is
// the contact picker — a bad line (empty items array) has no single input to
// sit under and lands in the form-level slot instead.
export type QuoteField = "contactId";

export type QuoteFormState = {
  error: string | null;
  field: QuoteField | null;
  values: { contactId: string };
};

function parseItems(formData: FormData) {
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

export async function createQuoteAction(
  _prevState: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const ctx = await requireTenantContext();
  const contactId = String(formData.get("contactId") ?? "");

  const parsed = createQuoteSchema.safeParse({
    contactId,
    dealId: formData.get("dealId") || undefined,
    discount: formData.get("discount") || 0,
    validUntil: formData.get("validUntil") || undefined,
    notes: formData.get("notes") || undefined,
    items: parseItems(formData),
  });

  if (!parsed.success) {
    const issues = parsed.error.issues;
    if (issues.some((issue) => issue.path[0] === "contactId")) {
      return { error: "contactRequired", field: "contactId", values: { contactId } };
    }
    // Now that the amount inputs are inputMode="numeric" and the browser no
    // longer blocks the submit, these two failures are both reachable and
    // must not share a message: a filled-in line the server rejects (a
    // decimal price, qty 0) is a different problem from an empty builder.
    if (issues.some((issue) => issue.path[0] === "items" && issue.path.length > 1)) {
      return { error: "itemInvalid", field: null, values: { contactId } };
    }
    if (issues.some((issue) => issue.path[0] === "discount")) {
      return { error: "discountInvalid", field: null, values: { contactId } };
    }
    // No line filled in with a description — a form-level failure, since
    // there's no single input the builder can point at.
    return { error: "itemsRequired", field: null, values: { contactId } };
  }

  let quote;
  try {
    quote = await createQuote(ctx, {
      contactId: parsed.data.contactId,
      dealId: parsed.data.dealId,
      discount: parsed.data.discount,
      validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : undefined,
      notes: parsed.data.notes,
      items: parsed.data.items,
    });
  } catch {
    return { error: "unknown", field: null, values: { contactId } };
  }

  revalidatePath("/quotes");
  redirect(`/quotes/${quote!.id}`);
}

// Hidden-id-only actions (PLAN.md §10 1R #6): every field these three post
// is a hidden input rendered from the quote already on screen — the id, and
// for the status buttons a fixed status — so a rejected submit has no
// user-fillable field to sit under. safeParse + a silent return, like the
// document issue/send buttons, rather than form state with nowhere to show
// it. None of them hides a refusal the user needs to read either: sendQuote
// records a WhatsApp failure on the activity and still marks the quote sent
// rather than throwing, and a quote with no items cannot exist, since
// createQuote requires at least one.
export async function sendQuoteAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = z.string().min(1).safeParse(formData.get("quoteId"));
  if (!parsed.success) return;
  await sendQuote(ctx, parsed.data);
  revalidatePath(`/quotes/${parsed.data}`);
}

/**
 * "Enviar por email" (PLAN.md §15.1, §15.8 P4) — the quote's public link and
 * PDF to the contact's own email address, through senderFor(ctx)'s identity.
 * Deliberately does not touch `quotes.status` or write a `quote_sent`
 * activity: those belong to modules/quotes (P6's Owns column). The button
 * only renders when the contact has an email (quotes/[id]/page.tsx), so a
 * silent no-op here is the tampered-form case, same as the other hidden-id
 * actions in this file.
 */
export async function sendQuoteByEmailAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = z.string().min(1).safeParse(formData.get("quoteId"));
  if (!parsed.success) return;

  const quote = await getQuote(ctx, parsed.data);
  if (!quote) return;

  const [pdf, tenant] = await Promise.all([generateQuotePdf(ctx, quote.id), getTenant(ctx.tenantId)]);
  const t = await getTranslator(tenant?.locale, "pdf.quote");
  const url = publicQuoteUrl(quote.publicToken);

  const result = await sendLinkEmail(ctx, {
    contactId: quote.contactId,
    subject: `${t("caption")} ${quote.number}`,
    lines: [`${t("caption")} ${quote.number}.`],
    linkLabel: url,
    linkUrl: url,
    attachment: { filename: `${quote.number}.pdf`, content: pdf },
  });

  if (result.sent) {
    await createActivity(ctx, {
      contactId: quote.contactId,
      dealId: quote.dealId ?? undefined,
      type: "system",
      payload: { kind: "quote_emailed", quoteId: quote.id, number: quote.number },
      userId: ctx.userId,
    });
  }

  revalidatePath(`/quotes/${parsed.data}`);
}

export async function setQuoteStatusAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = z
    .object({
      quoteId: z.string().min(1),
      status: z.enum(["draft", "sent", "accepted", "rejected", "expired"]),
    })
    .safeParse({ quoteId: formData.get("quoteId"), status: formData.get("status") });
  if (!parsed.success) return;

  await setQuoteStatus(ctx, parsed.data.quoteId, parsed.data.status);
  revalidatePath(`/quotes/${parsed.data.quoteId}`);
}

export async function convertQuoteToDocumentAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = z.string().min(1).safeParse(formData.get("quoteId"));
  if (!parsed.success) return;

  // redirect() throws for control flow, so it stays outside the try.
  let document;
  try {
    document = await createDocumentFromQuote(ctx, parsed.data);
  } catch {
    return;
  }

  revalidatePath(`/quotes/${parsed.data}`);
  redirect(`/documents/${document!.id}`);
}

/** Duplicates an expired quote into a fresh draft (PLAN.md §15.5 J12,
 *  §15.8 P6) rather than reviving the old one — prices and validity are
 *  exactly what needed a second look before sending again. */
export async function duplicateQuoteAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = z.string().min(1).safeParse(formData.get("quoteId"));
  if (!parsed.success) return;

  const created = await duplicateQuote(ctx, parsed.data);
  if (!created) return;

  revalidatePath("/quotes");
  redirect(`/quotes/${created.id}`);
}
