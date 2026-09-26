import { listUsersForTenant } from "@/modules/tenancy/users";
import type { TenantContext } from "@/modules/tenancy/context";
import { enqueuePush } from "@/modules/notifications/queue";
import { inboundThrottle } from "@/modules/notifications/fanout";
import { reportError } from "@/lib/observability";

// A new email arrived (PLAN-EMAIL.md E4). Same treatment as an inbound
// WhatsApp message (notifications/hooks.ts): a push to the business's active
// users, no bell row — the Inbox with its unread threads is the record — and
// the same two-minute throttle per thread so a burst is one buzz.
// Never throws: the mail is already stored.

export async function pushInboundEmail(
  ctx: TenantContext,
  input: { threadId: string; fromName: string | null; fromAddress: string; subject: string },
): Promise<void> {
  try {
    if (!inboundThrottle.claim(`email:${input.threadId}`)) return;
    const users = await listUsersForTenant(ctx.tenantId);
    for (const user of users.filter((u) => !u.banned)) {
      await enqueuePush(ctx.tenantId, user.id, "inbound_message", {
        title: `✉️ ${input.fromName?.trim() || input.fromAddress}`,
        body: input.subject.slice(0, 140) || null,
        url: `/email/${input.threadId}`,
        tag: `email:${input.threadId}`,
      });
    }
  } catch (err) {
    reportError(err, { tags: { area: "mailbox.notify" } });
  }
}
