import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/modules/tenancy/context";
import {
  getConversationById,
  getConversationMessages,
  isWithin24HourWindow,
  listApprovedTemplates,
} from "@/modules/whatsapp/queries";
import { getContactById } from "@/modules/crm/queries";
import { listMyTenantUsers } from "@/modules/tenancy/queries";
import { assignConversation, convertConversationToDeal } from "@/modules/whatsapp/conversation-actions";
import { ChatPane } from "@/components/chat-pane";
import { Button } from "@/components/ui/button";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getTenantContext();

  const conversation = await getConversationById(ctx, id);
  if (!conversation) notFound();

  const [contact, messages, templates, teammates] = await Promise.all([
    getContactById(ctx, conversation.contactId),
    getConversationMessages(ctx, id),
    listApprovedTemplates(ctx, conversation.waAccountId),
    listMyTenantUsers(ctx),
  ]);

  const withinWindow = isWithin24HourWindow(conversation.lastInboundAt);

  async function assign(formData: FormData) {
    "use server";
    const userId = String(formData.get("userId") ?? "");
    await assignConversation(id, userId || null);
  }

  async function convertToDeal() {
    "use server";
    await convertConversationToDeal(id);
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/inbox" className="text-sm text-muted-foreground hover:underline">
            ← Bandeja
          </Link>
          <h1 className="text-xl font-semibold">{contact?.name}</h1>
          <Link href={`/contacts/${contact?.id}`} className="text-sm text-muted-foreground hover:underline">
            {contact?.phone} · ver contacto
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <form action={assign} className="flex items-center gap-2">
            <select
              name="userId"
              defaultValue={conversation.assignedUserId ?? ""}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              <option value="">Sin asignar</option>
              {teammates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" size="sm">
              Asignar
            </Button>
          </form>

          <form action={convertToDeal}>
            <Button type="submit" variant="outline" size="sm">
              Convertir en negocio
            </Button>
          </form>
        </div>
      </div>

      <ChatPane
        conversationId={id}
        initialMessages={messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          type: m.type,
          body: m.body,
          templateName: m.templateName,
          status: m.status,
          createdAt: m.createdAt.toISOString(),
        }))}
        templates={templates.map((t) => ({ id: t.id, name: t.name, language: t.language }))}
        initialWithinWindow={withinWindow}
      />
    </div>
  );
}
