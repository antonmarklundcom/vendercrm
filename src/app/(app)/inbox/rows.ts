import { inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { contacts } from "@/db/schema";
import {
  listConversations,
  searchConversations,
  type InboxListFilter,
} from "@/modules/whatsapp/inbox";
import { listConversations as listChatConversations } from "@/modules/chatwidget/conversations";
import { tenantDb } from "@/modules/tenancy/db";
import type { TenantContext } from "@/modules/tenancy/context";

export const INBOX_FILTERS: InboxListFilter[] = ["all", "mine", "unassigned", "unread"];

export type InboxRow = {
  id: string;
  channel: "whatsapp" | "webchat";
  href: string;
  contactId: string | null;
  contactName: string;
  contactPhone: string;
  unreadCount: number;
  assignedUserId: string | null;
  lastMessageAt: number;
};

/**
 * The merged inbox list — WhatsApp conversations plus open web-chat threads
 * with a channel chip (PLAN.md §15.8 P3) — shared between the page's first
 * render and the 5s poll (`/api/inbox/conversations`) so both agree on what
 * a given filter/search shows. The two data models are not merged, only the
 * list a rep sees is: `modules/whatsapp/inbox.ts` and
 * `modules/chatwidget/conversations.ts` stay separate reads.
 *
 * Contacts are resolved in ONE batched query, the way the pre-P3 route did
 * (its own comment: this endpoint is polled every 5s by every open inbox
 * tab, so an N+1 here is the single most repeated query pattern in the
 * product).
 */
export async function getInboxRows(
  ctx: TenantContext,
  options: { filter?: InboxListFilter; q?: string },
): Promise<InboxRow[]> {
  const t = await getTranslations("app.inbox");
  const q = options.q?.trim() || undefined;
  const filter = options.filter ?? "all";

  const [conversations, chatConversations] = await Promise.all([
    q ? searchConversations(ctx, q) : listConversations(ctx, { filter }),
    // Web chat has no filter/search applied here — it carries its own on
    // /chat — so it only appears under the "all" view with no search typed,
    // to avoid an "unassigned" or a keyword match silently promising rows
    // that were never checked against it.
    filter === "all" && !q ? listChatConversations(ctx, { status: "open" }) : Promise.resolve([]),
  ]);

  const contactIds = [
    ...new Set(
      [
        ...conversations.map((c) => c.contactId),
        ...chatConversations.map((c) => c.contactId).filter((id): id is string => id !== null),
      ].filter(Boolean),
    ),
  ];
  const contactRows = contactIds.length
    ? await tenantDb(ctx).select(contacts, inArray(contacts.id, contactIds))
    : [];
  const contactById = new Map(contactRows.map((row) => [row.id, row]));

  const whatsappRows: InboxRow[] = conversations.map((conversation) => {
    const contact = contactById.get(conversation.contactId);
    return {
      id: conversation.id,
      channel: "whatsapp",
      href: `/inbox/${conversation.id}`,
      contactId: conversation.contactId,
      contactName: contact?.name ?? conversation.contactId,
      contactPhone: contact?.phone ?? "",
      unreadCount: conversation.unreadCount,
      assignedUserId: conversation.assignedUserId,
      lastMessageAt: conversation.lastMessageAt?.getTime() ?? 0,
    };
  });

  const chatRows: InboxRow[] = chatConversations.map((conversation) => {
    const contact = conversation.contactId ? contactById.get(conversation.contactId) : undefined;
    return {
      id: conversation.id,
      channel: "webchat",
      // No per-conversation route for web chat yet
      // (docs/SPEC-CHAT-WIDGET.md §5) — the whole transcript renders inline
      // on /chat itself.
      href: "/chat",
      contactId: conversation.contactId,
      contactName: contact?.name ?? t("unknownContact"),
      contactPhone: contact?.phone ?? "",
      unreadCount: conversation.unreadCount,
      assignedUserId: conversation.assignedUserId,
      lastMessageAt: conversation.lastMessageAt?.getTime() ?? 0,
    };
  });

  return [...whatsappRows, ...chatRows].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}
