import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import {
  getConversation,
  listMessagesForConversation,
  markConversationRead,
  isWithinFreeFormWindow,
} from "@/modules/whatsapp/inbox";
import { getContact } from "@/modules/crm/contacts";
import { AutoRefresh } from "../AutoRefresh";
import { listApprovedTemplates } from "@/modules/whatsapp/templates";
import { Button } from "@/components/ui/button";
import { sendTextAction, sendTemplateAction } from "../actions";

// Window countdown (§6.5). Rendered server-side, so it steps rather than
// ticks — AutoRefresh re-renders the page every 5s, which is close enough
// for a 24-hour countdown.
function formatRemaining(lastInboundAt: Date | null): string {
  if (!lastInboundAt) return "";
  const msLeft = lastInboundAt.getTime() + 24 * 60 * 60 * 1000 - Date.now();
  if (msLeft <= 0) return "";
  const hours = Math.floor(msLeft / (60 * 60 * 1000));
  const minutes = Math.floor((msLeft % (60 * 60 * 1000)) / (60 * 1000));
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.inbox");

  const conversation = await getConversation(ctx, id);
  if (!conversation) notFound();

  const [contact, messages, templates] = await Promise.all([
    getContact(ctx, conversation.contactId),
    listMessagesForConversation(ctx, id),
    listApprovedTemplates(ctx, conversation.waAccountId),
  ]);

  if (conversation.unreadCount > 0) {
    await markConversationRead(ctx, id);
  }

  const windowOpen = isWithinFreeFormWindow(conversation.lastInboundAt);
  const sendAction = sendTextAction;

  return (
    <div className="flex flex-col gap-4">
      <AutoRefresh />
      <h1 className="text-xl font-semibold">{contact?.name ?? conversation.contactId}</h1>
      <p className="text-sm text-muted-foreground">{contact?.phone}</p>

      <ul className="flex flex-col gap-2">
        {messages.map((message) => (
          <li
            key={message.id}
            className={`max-w-md rounded-md border px-3 py-2 text-sm ${
              message.direction === "out" ? "ml-auto bg-accent" : ""
            }`}
          >
            <p>{message.body}</p>
            <p className="text-xs text-muted-foreground">
              {message.createdAt.toLocaleString("es-PY")} · {message.status}
            </p>
          </li>
        ))}
        {messages.length === 0 && <li className="text-muted-foreground">{t("noMessages")}</li>}
      </ul>

      {windowOpen ? (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {t("windowOpen", { remaining: formatRemaining(conversation.lastInboundAt) })}
          </p>
          <form action={sendAction} className="flex gap-2">
            <input type="hidden" name="conversationId" value={id} />
            <input
              name="body"
              required
              placeholder={t("messagePlaceholder")}
              className="flex-1 rounded-md border px-3 py-2 text-sm"
            />
            <Button type="submit">{t("send")}</Button>
          </form>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <p className="rounded-md border bg-amber-100 px-3 py-2 text-sm text-amber-900">
            {t("windowClosed")}
          </p>
          {templates.length > 0 ? (
            <form action={sendTemplateAction} className="flex gap-2">
              <input type="hidden" name="conversationId" value={id} />
              <select name="template" required className="flex-1 rounded-md border px-3 py-2 text-sm">
                {templates.map((template) => (
                  <option
                    key={template.id}
                    value={`${template.name}|${template.language}`}
                  >
                    {template.name} ({template.language})
                  </option>
                ))}
              </select>
              <Button type="submit">{t("sendTemplate")}</Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noTemplates")}</p>
          )}
        </div>
      )}
    </div>
  );
}
