import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import {
  getAccountForTenant,
  listConversations,
  listMessages,
  getConversation,
  isWithinFreeformWindow,
  listApprovedTemplates,
} from "@/modules/whatsapp";
import { getContact } from "@/modules/crm/contacts";
import {
  connectManualAction,
  assignToMeAction,
  convertToDealAction,
  markReadAction,
  syncTemplatesAction,
} from "./actions";
import { AutoRefresh } from "./auto-refresh";
import { SendBox } from "./send-box";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const t = await getTranslations("app");
  const ctx = await requireTenantContext();
  const account = await getAccountForTenant(ctx);

  if (!account) {
    return (
      <div className="max-w-md">
        <h1 className="mb-2 text-xl font-semibold">{t("connectTitle")}</h1>
        <p className="mb-4 text-sm text-muted-foreground">{t("connectHelp")}</p>
        <form action={connectManualAction} className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="wabaId">{t("wabaId")}</Label>
            <Input id="wabaId" name="wabaId" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="phoneNumberId">{t("phoneNumberId")}</Label>
            <Input id="phoneNumberId" name="phoneNumberId" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="accessToken">{t("accessToken")}</Label>
            <Input id="accessToken" name="accessToken" type="password" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="displayNumber">{t("displayNumber")}</Label>
            <Input id="displayNumber" name="displayNumber" placeholder="+595 21 000 000" />
          </div>
          <Button type="submit" className="mt-2 w-fit">
            {t("connect")}
          </Button>
        </form>
      </div>
    );
  }

  const conversations = await listConversations(ctx);
  const selected = c ? await getConversation(ctx, c) : conversations[0] ?? null;
  const messages = selected ? await listMessages(ctx, selected.id) : [];
  const contact = selected ? await getContact(ctx, selected.contactId) : null;
  const windowOpen = selected ? isWithinFreeformWindow(selected) : false;
  const templates = await listApprovedTemplates(ctx, account.id);

  // Mark the open conversation read (best-effort; refresh shows the change).
  if (selected && selected.unreadCount > 0) {
    await markReadAction(selected.id);
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <AutoRefresh />
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("inbox")}</h1>
        <form action={async () => { "use server"; await syncTemplatesAction(account.id); }}>
          <Button type="submit" variant="outline" size="sm">
            {t("syncTemplates")}
          </Button>
        </form>
      </div>

      <div className="grid flex-1 grid-cols-3 gap-4 overflow-hidden">
        {/* Conversation list */}
        <div className="overflow-y-auto rounded-lg border">
          {conversations.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              {t("noConversations")}
            </p>
          )}
          {conversations.map((conv) => (
            <Link
              key={conv.id}
              href={`/app/inbox?c=${conv.id}`}
              className={`block border-b px-4 py-3 text-sm hover:bg-accent ${
                selected?.id === conv.id ? "bg-accent" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{conv.contactId.slice(-6)}</span>
                {conv.unreadCount > 0 && (
                  <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground">
                    {conv.unreadCount}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {conv.lastMessageAt?.toLocaleString("es-PY") ?? "—"}
              </div>
            </Link>
          ))}
        </div>

        {/* Chat pane */}
        <div className="col-span-2 flex flex-col overflow-hidden rounded-lg border">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b px-4 py-2">
                <div className="text-sm font-medium">
                  {contact?.name ?? contact?.phone ?? "—"}
                </div>
                <div className="flex gap-2">
                  <form action={async () => { "use server"; await assignToMeAction(selected.id); }}>
                    <Button type="submit" variant="ghost" size="sm">
                      {t("assignToMe")}
                    </Button>
                  </form>
                  <form action={async () => { "use server"; await convertToDealAction(selected.id); }}>
                    <Button type="submit" variant="ghost" size="sm">
                      {t("convertToDeal")}
                    </Button>
                  </form>
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      m.direction === "out"
                        ? "self-end bg-primary text-primary-foreground"
                        : "self-start bg-muted"
                    }`}
                  >
                    <div>{m.body ?? `[${m.type}]`}</div>
                    <div className="mt-1 text-[10px] opacity-70">
                      {m.direction === "out" ? m.status : ""}{" "}
                      {m.createdAt.toLocaleTimeString("es-PY")}
                    </div>
                  </div>
                ))}
              </div>

              <SendBox
                conversationId={selected.id}
                windowOpen={windowOpen}
                templates={templates.map((tpl) => ({
                  name: tpl.name,
                  language: tpl.language,
                }))}
              />
            </>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              {t("noConversations")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
