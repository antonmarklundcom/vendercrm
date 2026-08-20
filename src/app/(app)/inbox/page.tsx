import { MessagesSquare, Smartphone } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listConversations } from "@/modules/whatsapp/inbox";
import { listAccountsForTenant } from "@/modules/whatsapp/accounts";
import { listTenantUsers } from "@/modules/tenancy/users";
import { getContact } from "@/modules/crm/contacts";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { InboxList } from "./InboxList";

export default async function InboxPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.inbox");

  const [conversations, accounts, users] = await Promise.all([
    listConversations(ctx),
    listAccountsForTenant(ctx),
    listTenantUsers(ctx),
  ]);

  // Deactivated users included on purpose: a conversation assigned to
  // someone before they left must keep showing their name, or it reads as
  // unassigned and nobody picks it up. The picker (in the thread) offers
  // only active users; this map is for display.
  const userNames = Object.fromEntries(users.map((user) => [user.id, user.name]));
  const withContacts = await Promise.all(
    conversations.map(async (conversation) => ({
      conversation,
      contact: await getContact(ctx, conversation.contactId),
    })),
  );

  // An empty inbox has two very different causes: no number connected yet
  // (nothing can arrive) versus connected but quiet. Only the first one has
  // something for the user to do — and only an admin can do it (§3.2).
  const needsAccount = accounts.length === 0;
  const canConnect = ctx.role === "admin";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} description={t("intro")} />

      {withContacts.length === 0 ? (
        needsAccount ? (
          <EmptyState
            icon={Smartphone}
            title={t("emptyNoAccountTitle")}
            description={t("emptyNoAccountBody")}
            actionLabel={canConnect ? t("emptyAction") : undefined}
            actionHref={canConnect ? "/whatsapp" : undefined}
          />
        ) : (
          <EmptyState
            icon={MessagesSquare}
            title={t("emptyTitle")}
            description={t("emptyBody")}
          />
        )
      ) : (
        <InboxList
          initial={withContacts.map(({ conversation, contact }) => ({
            id: conversation.id,
            contactId: conversation.contactId,
            contactName: contact?.name ?? conversation.contactId,
            contactPhone: contact?.phone ?? "",
            unreadCount: conversation.unreadCount,
            assignedUserId: conversation.assignedUserId,
          }))}
          userNames={userNames}
        />
      )}
    </div>
  );
}
