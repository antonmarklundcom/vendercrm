"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/tenancy/context";
import { isMailboxAvailable } from "@/modules/tenancy/mailbox";
import { sendThreadReply } from "@/modules/mailbox/reply";
import { linkThread, markThreadRead, setThreadStatus } from "@/modules/mailbox/threads";
import { createContactFromThread } from "@/modules/mailbox/link";
import { mailboxReplyGuard } from "@/modules/mailbox/guard";

// The email Inbox (PLAN-EMAIL.md E4). Ordinary agent work, like the WhatsApp
// and chat inboxes — any member of the business may read and reply. Every
// action re-checks that the mailbox is available for this business, so a
// switched-off mailbox is closed on the server, not only hidden in the nav.

/** `values` comes back on an error so the form (reset by React after every
 *  action) shows what the person typed instead of an empty box. */
export type EmailFormState = {
  error: string | null;
  done: boolean;
  values?: Record<string, string>;
};

async function mailboxContext() {
  const ctx = await requireTenantContext();
  if (!(await isMailboxAvailable(ctx))) return null;
  return ctx;
}

const replySchema = z.object({
  threadId: z.string().min(1).max(26),
  body: z.string().max(20_000),
  cc: z.string().max(2_000).optional(),
});

export async function replyAction(_prev: EmailFormState, formData: FormData): Promise<EmailFormState> {
  const values = {
    body: String(formData.get("body") ?? ""),
    cc: String(formData.get("cc") ?? ""),
  };
  const ctx = await mailboxContext();
  if (!ctx) return { error: "unavailable", done: false, values };
  const parsed = replySchema.safeParse({
    threadId: formData.get("threadId"),
    body: formData.get("body") ?? "",
    cc: formData.get("cc") || undefined,
  });
  if (!parsed.success) return { error: "empty", done: false, values };

  const cc = parsed.data.cc
    ? parsed.data.cc.split(/[,;\s]+/).map((value) => value.trim()).filter(Boolean)
    : [];
  const result = await sendThreadReply(
    ctx,
    { threadId: parsed.data.threadId, body: parsed.data.body, cc },
    { guard: mailboxReplyGuard },
  );
  revalidatePath(`/email/${parsed.data.threadId}`);
  revalidatePath("/email");
  return result.ok ? { error: null, done: true } : { error: result.error, done: false, values };
}

const threadSchema = z.string().min(1).max(26);

export async function setThreadStatusAction(formData: FormData) {
  const ctx = await mailboxContext();
  if (!ctx) return;
  const id = threadSchema.safeParse(formData.get("threadId"));
  const status = z.enum(["open", "closed"]).safeParse(formData.get("status"));
  if (!id.success || !status.success) return;
  await setThreadStatus(ctx, id.data, status.data);
  revalidatePath("/email");
  revalidatePath(`/email/${id.data}`);
}

export async function markUnreadAction(formData: FormData) {
  const ctx = await mailboxContext();
  if (!ctx) return;
  const id = threadSchema.safeParse(formData.get("threadId"));
  if (!id.success) return;
  await markThreadRead(ctx, id.data, true);
  revalidatePath("/email");
}

const contactSchema = z.object({
  threadId: z.string().min(1).max(26),
  name: z.string().max(200),
  phone: z.string().min(1).max(30),
});

export async function createContactAction(
  _prev: EmailFormState,
  formData: FormData,
): Promise<EmailFormState> {
  const values = { name: String(formData.get("name") ?? ""), phone: String(formData.get("phone") ?? "") };
  const ctx = await mailboxContext();
  if (!ctx) return { error: "unavailable", done: false, values };
  const parsed = contactSchema.safeParse({
    threadId: formData.get("threadId"),
    name: formData.get("name") ?? "",
    phone: formData.get("phone") ?? "",
  });
  if (!parsed.success) return { error: "invalid", done: false, values };
  const result = await createContactFromThread(ctx, parsed.data.threadId, parsed.data);
  if ("error" in result) return { error: result.error, done: false, values };
  revalidatePath(`/email/${parsed.data.threadId}`);
  return { error: null, done: true };
}

export async function linkDealAction(formData: FormData) {
  const ctx = await mailboxContext();
  if (!ctx) return;
  const id = threadSchema.safeParse(formData.get("threadId"));
  const dealId = z.string().max(26).safeParse(formData.get("dealId") ?? "");
  if (!id.success || !dealId.success) return;
  await linkThread(ctx, id.data, { dealId: dealId.data || null });
  revalidatePath(`/email/${id.data}`);
}
