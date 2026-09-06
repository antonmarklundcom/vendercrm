import { registerHandler } from "@/worker/handlers";
import { enqueue } from "@/lib/queue";
import { env } from "@/lib/config/env";
import { listTenants } from "@/modules/tenancy/tenants";
import { buildSystemTenantContext, type TenantContext } from "@/modules/tenancy/context";
import { listUsersForTenant } from "@/modules/tenancy/users";
import { createNotification } from "@/modules/notifications/notifications";
import { sendEmail } from "@/lib/email";
import { weeklyBriefingEmail } from "@/lib/email/templates";
import { getContactByPhone } from "@/modules/crm/contacts";
import { getPrimaryAccount } from "@/modules/whatsapp/accounts";
import { getOrCreateConversation } from "@/modules/whatsapp/inbox";
import { sendTemplate } from "@/modules/whatsapp/send";
import { listApprovedTemplates } from "@/modules/whatsapp/templates";
import { getTranslator } from "@/lib/i18n/translator";
import { DEFAULT_TIMEZONE } from "@/lib/i18n/format";
import { todayIn, weekdayOf, zonedParts } from "@/modules/calendar/zoned-time";
import { createWeeklyBriefing, type CoachBriefingRow } from "./briefing";

// The Monday weekly briefing job (PLAN.md §15.3 L2, §17.2/§17.3 P14) —
// hourly self-rescheduling chain like `coach.morning` (docs/log/p7.md
// decision 1): no per-tenant "already sent" column, the chain just checks
// every tenant's local wall clock and acts on whichever ones currently read
// Monday 07:xx. The unique index on (tenant_id, week_start) makes a second
// pass inside the same hour, or a restart later the same day, a no-op.

export const COACH_WEEKLY_JOB_TYPE = "coach.weekly";
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const BRIEFING_HOUR = 7;
const MONDAY = 1;
const BRIEFING_TEMPLATE_NAME = "briefing_semanal";

registerHandler(COACH_WEEKLY_JOB_TYPE, async () => {
  await sendWeeklyBriefings();
  await enqueue(COACH_WEEKLY_JOB_TYPE, {}, { runAt: new Date(Date.now() + CHECK_INTERVAL_MS) });
});

/** One pass over every tenant currently in its local Monday 07:00 hour —
 *  exported for the worker registration above and for direct testing. */
export async function sendWeeklyBriefings(now: Date = new Date()): Promise<number> {
  let sent = 0;

  for (const tenant of await listTenants()) {
    const timeZone = tenant.timezone || DEFAULT_TIMEZONE;
    if (zonedParts(now, timeZone).hour !== BRIEFING_HOUR) continue;

    const today = todayIn(timeZone, now);
    if (weekdayOf(today) !== MONDAY) continue;

    const ctx = await buildSystemTenantContext(tenant.id);
    if (!ctx) continue;

    const briefing = await createWeeklyBriefing(ctx, today);
    if (!briefing) continue; // already has one for this week

    await deliverBriefing(ctx, tenant, briefing);
    sent += 1;
  }

  return sent;
}

async function deliverBriefing(
  ctx: TenantContext,
  tenant: { id: string; name: string; locale: string | null },
  briefing: CoachBriefingRow,
): Promise<void> {
  const briefingUrl = `${env.APP_URL}/dashboard/briefings/${briefing.id}`;
  const admins = (await listUsersForTenant(tenant.id)).filter(
    (user) => !user.banned && user.role === "admin",
  );
  const t = await getTranslator(tenant.locale, "app.dashboard.briefing");

  for (const admin of admins) {
    await createNotification(ctx, {
      userId: admin.id,
      kind: "system",
      title: t("notificationTitle"),
      body: briefing.narrative,
      url: `/dashboard/briefings/${briefing.id}`,
    });

    if (admin.email) {
      const { subject, html } = await weeklyBriefingEmail({
        businessName: tenant.name,
        summary: briefing.narrative,
        recommendations: briefing.recommendations,
        briefingUrl,
        locale: tenant.locale,
      });
      await sendEmail({ to: admin.email, subject, html, ctx, kind: "transactional" });
    }
  }

  await deliverBriefingWhatsapp(ctx);
}

/**
 * WhatsApp copy to the owner's own number (§15.3), sent only when the
 * tenant's synced templates already contain `briefing_semanal` — an
 * approved template is the only legal way to open a fresh 24h window, and
 * nothing here submits one. Skipped with a reason on the log row otherwise:
 * this phase never sends WhatsApp free text (hard limit).
 */
async function deliverBriefingWhatsapp(ctx: TenantContext): Promise<void> {
  const account = await getPrimaryAccount(ctx);
  if (!account || !account.displayNumber) return;

  const templates = await listApprovedTemplates(ctx, account.id);
  if (!templates.some((template) => template.name === BRIEFING_TEMPLATE_NAME)) return;

  // "The tenant's contact-number conversation" — the business's own
  // WhatsApp number, reached the same way any other contact is: by phone.
  const ownerContact = await getContactByPhone(ctx, account.displayNumber);
  if (!ownerContact) return;

  const conversation = await getOrCreateConversation(ctx, account.id, ownerContact.id);
  if (!conversation) return;

  await sendTemplate(ctx, {
    conversationId: conversation.id,
    templateName: BRIEFING_TEMPLATE_NAME,
    language: "es",
  });
}
