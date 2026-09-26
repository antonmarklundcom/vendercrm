import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Paperclip } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateTime } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import { storage } from "@/lib/storage";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import { isMailboxAvailable } from "@/modules/tenancy/mailbox";
import { getContact } from "@/modules/crm/contacts";
import { listDealsForContact } from "@/modules/crm/deals";
import { getMailbox } from "@/modules/mailbox/mailboxes";
import {
  getThread,
  listAttachmentsForMessages,
  listThreadMessages,
  markThreadRead,
} from "@/modules/mailbox/threads";
import { allowRemoteImages, hasBlockedImages } from "@/modules/mailbox/sanitize";
import { MAX_RECIPIENTS } from "@/modules/mailbox/reply";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form-fields";
import { CreateContactForm, ReplyForm } from "../EmailForms";
import { linkDealAction, markUnreadAction, setThreadStatusAction } from "../actions";

// One email thread (PLAN-EMAIL.md E4). HTML was sanitized when it was stored
// (modules/mailbox/sanitize.ts); remote images stay blocked unless the reader
// asks for them with ?images=1, and inline cid: images resolve to short-lived
// signed URLs of the message's own attachments. Attachments download through
// the same signed URLs.

const SIGNED_URL_SECONDS = 15 * 60;

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export default async function EmailThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ images?: string }>;
}) {
  const ctx = await requireTenantContext();
  if (!(await isMailboxAvailable(ctx))) notFound();

  const { id } = await params;
  const showImages = (await searchParams).images === "1";
  const thread = await getThread(ctx, id);
  if (!thread) notFound();
  if (thread.unread) await markThreadRead(ctx, thread.id);

  const t = await getTranslations("app.email");
  const locale = await getLocale();

  const [messages, mailbox, tenant, contact] = await Promise.all([
    listThreadMessages(ctx, thread.id),
    getMailbox(ctx, thread.mailboxId),
    getTenant(ctx.tenantId),
    thread.contactId ? getContact(ctx, thread.contactId) : Promise.resolve(null),
  ]);
  const deals = contact ? await listDealsForContact(ctx, contact.id) : [];
  const attachments = await listAttachmentsForMessages(ctx, messages.map((m) => m.id));
  const signed = new Map(
    await Promise.all(
      attachments.map(
        async (a) => [a.id, await storage.getSignedUrl(a.storageKey, SIGNED_URL_SECONDS)] as const,
      ),
    ),
  );

  let anyBlocked = false;
  const rendered = messages.map((message) => {
    const own = attachments.filter((a) => a.emailMessageId === message.id);
    let html = message.htmlBody;
    if (html) {
      if (hasBlockedImages(html)) anyBlocked = true;
      if (showImages) html = allowRemoteImages(html);
      html = html.replace(/src="cid:([^"]+)"/g, (match, cid: string) => {
        const attachment = own.find((a) => a.contentId === cid.replace(/^<|>$/g, ""));
        const url = attachment ? signed.get(attachment.id) : undefined;
        return url ? `src="${escapeAttribute(url)}"` : match;
      });
    }
    return { message, html, files: own.filter((a) => !a.contentId || !message.htmlBody?.includes(`cid:${a.contentId}`)) };
  });

  const lastInbound = [...messages].reverse().find((m) => m.direction === "in");
  const replyTo = lastInbound?.replyTo || lastInbound?.fromAddress || thread.participantEmail;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/email"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold break-words">{thread.subject || t("noSubject")}</h1>
            <p className="text-sm text-muted-foreground">
              {thread.participantName ? `${thread.participantName} · ` : ""}
              <span className="font-mono">{thread.participantEmail}</span>
              {mailbox ? ` → ${mailbox.address}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={markUnreadAction}>
              <input type="hidden" name="threadId" value={thread.id} />
              <Button type="submit" size="sm" variant="outline">
                {t("markUnread")}
              </Button>
            </form>
            <form action={setThreadStatusAction}>
              <input type="hidden" name="threadId" value={thread.id} />
              <input type="hidden" name="status" value={thread.status === "open" ? "closed" : "open"} />
              <Button type="submit" size="sm" variant="outline">
                {thread.status === "open" ? t("close") : t("reopen")}
              </Button>
            </form>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
          {contact ? (
            <div className="flex flex-wrap items-center gap-3">
              <span>
                {t("contact")}:{" "}
                <Link href={`/contacts/${contact.id}`} className="font-medium underline underline-offset-4">
                  {contact.name}
                </Link>
              </span>
              {deals.length > 0 && (
                <form action={linkDealAction} className="flex items-center gap-2">
                  <input type="hidden" name="threadId" value={thread.id} />
                  <Select name="dealId" defaultValue={thread.dealId ?? ""} className="h-8">
                    <option value="">{t("noDeal")}</option>
                    {deals.map((deal) => (
                      <option key={deal.id} value={deal.id}>
                        {deal.title}
                      </option>
                    ))}
                  </Select>
                  <Button type="submit" size="sm" variant="ghost">
                    {t("linkDeal")}
                  </Button>
                </form>
              )}
              {thread.dealId && (
                <Link href={`/pipeline/${thread.dealId}`} className="underline underline-offset-4">
                  {t("openDeal")}
                </Link>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground">{t("noContact")}</p>
              <CreateContactForm
                threadId={thread.id}
                defaultName={thread.participantName ?? ""}
                labels={{
                  title: t("createContact"),
                  name: t("contactName"),
                  phone: t("contactPhone"),
                  submit: t("createContact"),
                  errors: {
                    invalid: t("errors.invalidPhone"),
                    not_found: t("errors.not_found"),
                    unavailable: t("errors.unavailable"),
                    unknown: t("errors.unknown"),
                  },
                }}
              />
            </div>
          )}
        </div>
      </div>

      {anyBlocked && !showImages && (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
          {t("imagesBlocked")}
          <Link href={`/email/${thread.id}?images=1`} className="font-medium underline underline-offset-4">
            {t("showImages")}
          </Link>
        </p>
      )}

      <ol className="flex flex-col gap-4">
        {rendered.map(({ message, html, files }) => (
          <li
            key={message.id}
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-4",
              message.direction === "out" && "border-primary/30 bg-accent/40",
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">
                {message.fromName || message.fromAddress}
                {message.fromName && (
                  <span className="ml-1 font-mono text-xs text-muted-foreground">{message.fromAddress}</span>
                )}
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {message.direction === "out" && message.status !== "sent" && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5",
                      message.status === "failed" || message.status === "bounced"
                        ? "bg-destructive-surface text-destructive"
                        : "bg-muted",
                    )}
                  >
                    {t(`status.${message.status}` as "status.failed")}
                  </span>
                )}
                <time dateTime={message.sentAt.toISOString()}>
                  {formatDateTime(message.sentAt, locale, tenant?.timezone)}
                </time>
              </span>
            </div>
            {html ? (
              <div
                className="max-w-none overflow-x-auto break-words text-sm [&_a]:underline [&_img]:inline [&_img]:max-w-full [&_p]:my-2"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <pre className="font-sans text-sm whitespace-pre-wrap break-words">{message.textBody}</pre>
            )}
            {files.length > 0 && (
              <ul className="flex flex-wrap gap-2 pt-1">
                {files.map((file) => (
                  <li key={file.id}>
                    <a
                      href={signed.get(file.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                    >
                      <Paperclip className="size-3" aria-hidden="true" />
                      {file.filename}
                      <span className="text-muted-foreground">({Math.max(1, Math.round(file.size / 1024))} KB)</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>

      <ReplyForm
        threadId={thread.id}
        to={replyTo}
        labels={{
          to: t("replyTo"),
          cc: t("cc"),
          ccHelp: t("ccHelp", { max: MAX_RECIPIENTS - 1 }),
          body: t("body"),
          send: t("send"),
          sent: t("sent"),
          errors: {
            empty: t("errors.empty"),
            not_found: t("errors.not_found"),
            unavailable: t("errors.unavailable"),
            mailbox_inactive: t("errors.mailbox_inactive"),
            suspended: t("errors.suspended"),
            invalid_recipient: t("errors.invalid_recipient"),
            too_many_recipients: t("errors.too_many_recipients", { max: MAX_RECIPIENTS }),
            daily_limit: t("errors.daily_limit"),
            send_failed: t("errors.send_failed"),
            unknown: t("errors.unknown"),
          },
        }}
      />
    </div>
  );
}
