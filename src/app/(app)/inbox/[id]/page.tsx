import { notFound } from "next/navigation";
import { requireTenantContext } from "@/modules/tenancy/context";
import {
  getConversation,
  listMessagesForConversation,
  markConversationRead,
  isWithinFreeFormWindow,
  toThreadMessages,
} from "@/modules/whatsapp/inbox";
import { listNotesForConversation } from "@/modules/whatsapp/notes";
import { listQuickReplies } from "@/modules/whatsapp/quick-replies";
import { getContact } from "@/modules/crm/contacts";
import { listApprovedTemplates } from "@/modules/whatsapp/templates";
import { listPendingDrafts } from "@/modules/ai/replies";
import { listTenantUsers } from "@/modules/tenancy/users";
import { listBookingTypes } from "@/modules/booking/types";
import { ConversationView, type ConversationData } from "./ConversationView";
import { DEFAULT_COUNTRY, waMeHref } from "@/lib/phone";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenantContext();

  const conversation = await getConversation(ctx, id);
  if (!conversation) notFound();

  const tenantRow = await getTenant(ctx.tenantId);
  const defaultCountry =
    ((tenantRow?.settings ?? {}) as TenantSettings).defaultCountry ?? DEFAULT_COUNTRY;

  const [contact, messages, templates, aiDrafts, users, bookingTypes, notes, quickReplies] =
    await Promise.all([
      getContact(ctx, conversation.contactId),
      listMessagesForConversation(ctx, id),
      listApprovedTemplates(ctx, conversation.waAccountId),
      listPendingDrafts(ctx, id),
      listTenantUsers(ctx),
      listBookingTypes(ctx),
      listNotesForConversation(ctx, id),
      listQuickReplies(ctx),
    ]);

  if (conversation.unreadCount > 0) {
    await markConversationRead(ctx, id);
  }

  const initial: ConversationData = {
    contact: contact
      ? {
          name: contact.name,
          phone: contact.phone,
          whatsappHref: waMeHref(contact.phone, defaultCountry),
        }
      : null,
    conversation: {
      id: conversation.id,
      contactId: conversation.contactId,
      lastInboundAt: conversation.lastInboundAt ? conversation.lastInboundAt.toISOString() : null,
      aiDisabledAt: conversation.aiDisabledAt ? conversation.aiDisabledAt.toISOString() : null,
      assignedUserId: conversation.assignedUserId,
    },
    messages: await toThreadMessages(messages),
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      authorUserId: n.authorUserId,
      createdAt: n.createdAt.toISOString(),
    })),
    templates: templates.map((t) => ({ id: t.id, name: t.name, language: t.language })),
    aiDrafts: aiDrafts.map((d) => ({
      id: d.id,
      body: d.body,
      provider: d.provider,
      model: d.model,
      promptTokens: d.promptTokens,
      completionTokens: d.completionTokens,
    })),
    windowOpen: isWithinFreeFormWindow(conversation.lastInboundAt),
  };

  // The user list is a prop rather than part of `initial`: it is the one
  // piece here that the 5s poll has no reason to re-fetch (§6.5).
  return (
    <ConversationView
      conversationId={id}
      initial={initial}
      users={users.filter((user) => !user.banned).map((user) => ({ id: user.id, name: user.name }))}
      // Deactivated users included, same reason as the inbox list: a note
      // written before someone left must still show their name.
      userNames={Object.fromEntries(users.map((user) => [user.id, user.name]))}
      bookingTypes={bookingTypes
        .filter((type) => type.isActive)
        .map((type) => ({ id: type.id, name: type.name }))}
      quickReplies={quickReplies.map((reply) => ({ id: reply.id, name: reply.name, body: reply.body }))}
    />
  );
}
