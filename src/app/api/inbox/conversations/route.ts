import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { contacts } from "@/db/schema";
import { tenantDb } from "@/modules/tenancy/db";
import { listConversations } from "@/modules/whatsapp/inbox";
import { requireSession } from "@/lib/api/guards";

// Backs the inbox list's 5s poll (PLAN.md §6.5). Session-authenticated,
// same-origin only — no API key path, unlike /api/v1/leads.
//
// The contacts are fetched in ONE query keyed by the conversations already
// loaded, not one query per conversation. This route runs every 5 seconds
// for every rep with the inbox open, so an N+1 here is the single most
// repeated query pattern in the product: a tenant with 200 conversations
// was issuing 201 statements per poll, per open tab, against Hostinger's
// single MySQL (§2.1).
export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  const conversations = await listConversations(ctx);

  const contactIds = [...new Set(conversations.map((c) => c.contactId))];
  const contactRows = contactIds.length
    ? await tenantDb(ctx).select(contacts, inArray(contacts.id, contactIds))
    : [];
  const contactById = new Map(contactRows.map((row) => [row.id, row]));

  const withContacts = conversations.map((conversation) => {
    const contact = contactById.get(conversation.contactId);
    return {
      id: conversation.id,
      contactId: conversation.contactId,
      contactName: contact?.name ?? conversation.contactId,
      contactPhone: contact?.phone ?? "",
      unreadCount: conversation.unreadCount,
      // Just the id: the tenant's user list is passed once from the page and
      // does not change between polls, so resolving names here would add a
      // second query to the most repeated request in the product.
      assignedUserId: conversation.assignedUserId,
      lastMessageAt: conversation.lastMessageAt,
    };
  });

  return NextResponse.json(
    { conversations: withContacts },
    { headers: { "Cache-Control": "no-store" } },
  );
}
