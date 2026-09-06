import type { TenantContext } from "@/modules/tenancy/context";
import { getContact } from "@/modules/crm/contacts";
import { sendEmail } from "./index";
import { buildUnsubscribeUrl } from "./unsubscribe";

// "Enviar por email" on the quote and nota de venta detail pages (PLAN.md
// §15.1, §15.8 P4). One shared function rather than one per document type:
// both send the public link (and a PDF attachment where one is already
// rendered) to the contact's own email, through the same senderFor identity.
//
// Deliberately does not touch quote/document status or write their own
// activity types (quote_sent, etc.) — those belong to modules/quotes and
// modules/documents (P6's Owns column), which this phase does not modify.
// A generic timeline entry is enough to say "we emailed this".

export type SendLinkEmailInput = {
  contactId: string;
  subject: string;
  /** Plain-text body lines — turned into simple paragraphs, since this is a
   *  short "here is your quote/document" note, not a branded template. */
  lines: string[];
  linkLabel: string;
  linkUrl: string;
  attachment?: { filename: string; content: Buffer };
  /** Automated emails get the unsubscribe footer (§15.1); this is a rep
   *  clicking a button, so it stays transactional and unsubscribe-free. */
  automated?: boolean;
};

export async function sendLinkEmail(
  ctx: TenantContext,
  input: SendLinkEmailInput,
): Promise<{ sent: boolean; reason?: "no_email" }> {
  const contact = await getContact(ctx, input.contactId);
  if (!contact?.email) return { sent: false, reason: "no_email" };

  const paragraphs = input.lines.map((line) => `<p>${line}</p>`).join("\n");
  const linkHtml = `<p><a href="${input.linkUrl}">${input.linkLabel}</a></p>`;
  const unsubscribeHtml = input.automated
    ? `<p style="font-size:12px;color:#888"><a href="${buildUnsubscribeUrl(ctx.tenantId, contact.id)}">Cancelar suscripción</a></p>`
    : "";

  // No explicit `from`/`replyTo`: sendEmail resolves senderFor(ctx) itself
  // when a ctx is given and neither is set (§15.1).
  const sent = await sendEmail({
    to: contact.email,
    subject: input.subject,
    html: `${paragraphs}\n${linkHtml}\n${unsubscribeHtml}`,
    attachments: input.attachment ? [input.attachment] : undefined,
    ctx,
    kind: input.automated ? "automated" : "transactional",
  });

  return { sent };
}
