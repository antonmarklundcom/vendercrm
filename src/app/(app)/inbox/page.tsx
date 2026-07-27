import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listConversations } from "@/modules/whatsapp/inbox";
import { getContact } from "@/modules/crm/contacts";
import { AutoRefresh } from "./AutoRefresh";

export default async function InboxPage() {
  const ctx = await requireTenantContext();

  // Hiding the nav link is not access control — a client must be refused
  // here too, or the URL alone would be enough (PLAN.md §5.2).
  if (ctx.role === "client") {
    return <p className="text-muted-foreground">{(await getTranslations("app"))("clientPortalOnly")}</p>;
  }
  const t = await getTranslations("app.inbox");

  const conversations = await listConversations(ctx);
  const withContacts = await Promise.all(
    conversations.map(async (conversation) => ({
      conversation,
      contact: await getContact(ctx, conversation.contactId),
    })),
  );

  return (
    <div className="flex flex-col gap-4">
      <AutoRefresh />
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <ul className="flex flex-col gap-2 text-sm">
        {withContacts.map(({ conversation, contact }) => (
          <li key={conversation.id}>
            <Link
              href={`/inbox/${conversation.id}`}
              className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-accent"
            >
              <span>
                <span className="font-medium">{contact?.name ?? conversation.contactId}</span>{" "}
                <span className="text-muted-foreground">{contact?.phone}</span>
              </span>
              {conversation.unreadCount > 0 && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                  {conversation.unreadCount}
                </span>
              )}
            </Link>
          </li>
        ))}
        {withContacts.length === 0 && <li className="text-muted-foreground">{t("empty")}</li>}
      </ul>
    </div>
  );
}
