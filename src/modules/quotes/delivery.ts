import { env } from "@/lib/config/env";
import type { TenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { getContact } from "@/modules/crm/contacts";
import { createActivity } from "@/modules/crm/activities";
import { getTranslator } from "@/lib/i18n/translator";
import {
  sendDocumentOverWhatsapp,
  storeDocumentPdf,
} from "@/modules/renderable-document/delivery";
import { quoteEvents } from "./events";
import { getQuote, listQuoteItems, setQuotePdfKey, setQuoteStatus } from "./quotes";
import { renderQuotePdf } from "./pdf";

// Thrown messages are stable codes, not copy (PLAN.md §13 H5 #4): a
// literal Spanish sentence here is a string the user might see in an
// unknown language, and one nothing can translate. The UI turns these into
// the reader's own language — an action's form state where there is a form,
// the route group's error boundary where there isn't.

// Quote delivery (PLAN.md §8): render the PDF with tenant branding, store it
// via the storage adapter, then send it as a WhatsApp document — with the
// public link /q/[token] as the fallback and preview.

export function publicQuoteUrl(token: string): string {
  return `${env.APP_URL}/q/${token}`;
}

/** Meta fetches this URL itself, so it has to be reachable without a session. */
export function publicQuotePdfUrl(token: string): string {
  return `${env.APP_URL}/q/${token}/pdf`;
}

export async function generateQuotePdf(ctx: TenantContext, quoteId: string): Promise<Buffer> {
  const quote = await getQuote(ctx, quoteId);
  if (!quote) throw new Error(`quote_not_found:${quoteId}`);

  const [items, contact, tenant] = await Promise.all([
    listQuoteItems(ctx, quote.id),
    getContact(ctx, quote.contactId),
    getTenant(ctx.tenantId),
  ]);
  if (!contact) throw new Error("contact_not_found");

  const settings = (tenant?.settings ?? {}) as TenantSettings;

  const pdf = await renderQuotePdf({
    number: quote.number,
    tenantName: tenant?.name ?? "",
    branding: settings.branding ?? {},
    contactName: contact.name,
    contactPhone: contact.phone,
    currency: quote.currency,
    subtotal: quote.subtotal,
    discount: quote.discount,
    total: quote.total,
    validUntil: quote.validUntil,
    notes: quote.notes,
    createdAt: quote.createdAt,
    locale: tenant?.locale,
    items: items.map((item) => ({
      description: item.description,
      qty: item.qty,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
  });

  const stored = await storeDocumentPdf(ctx, { kind: "quotes", id: quote.id, pdf });
  await setQuotePdfKey(ctx, quote.id, stored.key);

  return pdf;
}

export type SendQuoteResult = {
  /** Null when WhatsApp couldn't be used — the public link is then the delivery. */
  messageId: string | null;
  publicUrl: string;
  whatsappError?: string;
};

/**
 * Sends the quote over WhatsApp and flips it to `sent` with a `quote_sent`
 * activity (§8). A closed 24h window is an expected outcome, not a failure:
 * the PDF and public link still exist, so the status still advances and the
 * reason is reported back for the UI to show.
 */
export async function sendQuote(ctx: TenantContext, quoteId: string): Promise<SendQuoteResult> {
  const quote = await getQuote(ctx, quoteId);
  if (!quote) throw new Error(`quote_not_found:${quoteId}`);

  await generateQuotePdf(ctx, quote.id);

  const publicUrl = publicQuoteUrl(quote.publicToken);
  const tenant = await getTenant(ctx.tenantId);
  // The caption reaches the customer, so it follows the tenant's locale like
  // the PDF beside it (§13 H5 #4).
  const t = await getTranslator(tenant?.locale, "pdf.quote");
  const captionPrefix = t("caption");


  const delivery = await sendDocumentOverWhatsapp(ctx, {
    contactId: quote.contactId,
    link: publicQuotePdfUrl(quote.publicToken),
    filename: `${quote.number}.pdf`,
    caption: `${captionPrefix} ${quote.number}`,
  });
  const { messageId, whatsappError } = delivery;

  await setQuoteStatus(ctx, quote.id, "sent");
  await createActivity(ctx, {
    contactId: quote.contactId,
    dealId: quote.dealId ?? undefined,
    type: "quote_sent",
    payload: {
      quoteId: quote.id,
      number: quote.number,
      total: quote.total,
      currency: quote.currency,
      publicUrl,
      viaWhatsapp: messageId !== null,
      whatsappError,
    },
    userId: ctx.userId,
  });

  // Fired after the activity, so a listener that reads the timeline sees the
  // same history the rep does. Emitting is not delivery: the quote is "sent"
  // whether or not WhatsApp took it, and a follow-up sequence keyed on this
  // is exactly what a closed window needs (§15.5 J1).
  await quoteEvents.emit("quote.sent", {
    tenantId: ctx.tenantId,
    contactId: quote.contactId,
    quoteId: quote.id,
    dealId: quote.dealId ?? null,
    number: quote.number,
    total: quote.total,
    currency: quote.currency,
  });

  return { messageId, publicUrl, whatsappError };
}
