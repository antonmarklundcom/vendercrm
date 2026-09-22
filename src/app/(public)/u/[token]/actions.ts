"use server";

import { notFound, redirect } from "next/navigation";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { getContact, listTags, createTag, addTagToContact } from "@/modules/crm/contacts";
import { OPTOUT_TAG } from "@/modules/automations/actions";

// The write half of /u/[token]. Sets the same `optout` tag the WhatsApp
// BAJA/STOP keyword sets (modules/automations/triggers.ts's maybeOptOut) —
// one flag, both channels. It lives behind a POST so a mail client's link
// prefetcher or a corporate link scanner, which only ever GETs, can't opt
// anyone out on their behalf.
export async function confirmUnsubscribeAction(token: string) {
  const resolved = verifyUnsubscribeToken(token);
  if (!resolved) notFound();

  const ctx = await buildSystemTenantContext(resolved.tenantId);
  if (!ctx) notFound();

  const contact = await getContact(ctx, resolved.contactId);
  if (!contact) notFound();

  const tags = await listTags(ctx);
  const existing = tags.find((tag) => tag.name.toLowerCase() === OPTOUT_TAG);
  const tag = existing ?? (await createTag(ctx, { name: OPTOUT_TAG }));
  // addTagToContact is idempotent, so a double submit is harmless.
  if (tag) await addTagToContact(ctx, contact.id, tag.id);

  redirect(`/u/${token}?listo=1`);
}
