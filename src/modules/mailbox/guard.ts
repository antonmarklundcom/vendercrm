import { and, eq, gte, inArray } from "drizzle-orm";
import { emailMessages, mailboxes } from "@/db/schema";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getTenantLimits } from "@/modules/tenancy/limits";
import type { ReplyGuard } from "./reply";

// Blast-radius guard for mailbox replies (PLAN-EMAIL.md E5). Every business
// sends through the platform's one Cloudflare account, whose quota and
// reputation are shared — so one business's volume is capped per rolling
// 24 h, lower still while it is new:
//
//   cap = min(MAILBOX_DAILY_CAP, plan.maxEmailsPerDay if the plan sets one)
//   first WARMUP_DAYS after the business's first mailbox address: min(cap, WARMUP_DAILY_CAP)
//
// Counted: outbound mailbox messages that reached the provider or are on
// their way (queued, sent, bounced, complained). A send the provider refused
// outright ("failed") doesn't count, as it doesn't count against Cloudflare's
// quota either.

export const MAILBOX_DAILY_CAP = 200;
export const WARMUP_DAILY_CAP = 20;
export const WARMUP_DAYS = 14;

const COUNTED = ["queued", "sent", "bounced", "complained"] as const;

export function dailyCapFor(input: {
  firstMailboxAt: Date | null;
  planCap: number | null | undefined;
  now: Date;
}): { cap: number; warmingUp: boolean } {
  let cap = MAILBOX_DAILY_CAP;
  if (input.planCap) cap = Math.min(cap, input.planCap);
  const warmingUp =
    !input.firstMailboxAt ||
    input.now.getTime() - input.firstMailboxAt.getTime() < WARMUP_DAYS * 86_400_000;
  if (warmingUp) cap = Math.min(cap, WARMUP_DAILY_CAP);
  return { cap, warmingUp };
}

export async function mailboxSendStats(ctx: TenantContext, now: Date = new Date()) {
  const since = new Date(now.getTime() - 86_400_000);
  const [sentLast24h, [first], limits] = await Promise.all([
    tenantDb(ctx).count(
      emailMessages,
      and(
        eq(emailMessages.direction, "out"),
        inArray(emailMessages.status, [...COUNTED]),
        gte(emailMessages.createdAt, since),
      ),
    ),
    tenantDb(ctx).select(mailboxes).orderBy(mailboxes.createdAt).limit(1),
    getTenantLimits(ctx.tenantId),
  ]);
  const { cap, warmingUp } = dailyCapFor({
    firstMailboxAt: first?.createdAt ?? null,
    planCap: limits.maxEmailsPerDay,
    now,
  });
  return { sentLast24h, cap, warmingUp };
}

export const mailboxReplyGuard: ReplyGuard = async (ctx) => {
  const stats = await mailboxSendStats(ctx);
  return stats.sentLast24h >= stats.cap ? "daily_limit" : null;
};
