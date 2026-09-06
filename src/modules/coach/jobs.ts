import { registerHandler } from "@/worker/handlers";
import { enqueue } from "@/lib/queue";
import { listTenants } from "@/modules/tenancy/tenants";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { listUsersForTenant } from "@/modules/tenancy/users";
import { createNotification } from "@/modules/notifications/notifications";
import { getTranslator } from "@/lib/i18n/translator";
import { DEFAULT_TIMEZONE } from "@/lib/i18n/format";
import { zonedParts } from "@/modules/calendar/zoned-time";
import { buildHoy } from "./hoy";

// The morning push (PLAN.md §15.3 L1, §15.8 P7) — the same Hoy list each
// user sees on the dashboard, delivered as a notification (which is what
// carries P2's web push, per `notifications/notifications.ts`'s own design:
// the row is the notification, the push is a second copy of it).
//
// "Tenant timezone 08:00" without a new column to remember who was already
// sent today: the chain runs hourly rather than daily, and each pass only
// mails a tenant whose local wall clock currently reads 08:xx — so every
// tenant gets exactly one pass through its own 08:00 hour per day, with no
// per-tenant state to persist. Documented in docs/log/p7.md.

export const COACH_MORNING_JOB_TYPE = "coach.morning";
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const MORNING_HOUR = 8;

registerHandler(COACH_MORNING_JOB_TYPE, async () => {
  await sendMorningDigests();
  await enqueue(COACH_MORNING_JOB_TYPE, {}, { runAt: new Date(Date.now() + CHECK_INTERVAL_MS) });
});

/** One notification per user, per tenant currently in its local 08:00 hour —
 *  skipped for a user with nothing on their list, the same "no empty
 *  reminder" rule crm/task-reminders.ts uses. Exported for the worker
 *  registration above and for direct testing. */
export async function sendMorningDigests(now: Date = new Date()): Promise<number> {
  let sent = 0;

  for (const tenant of await listTenants()) {
    const timeZone = tenant.timezone || DEFAULT_TIMEZONE;
    if (zonedParts(now, timeZone).hour !== MORNING_HOUR) continue;

    const ctx = await buildSystemTenantContext(tenant.id);
    if (!ctx) continue;

    const t = await getTranslator(tenant.locale, "app.dashboard.hoy");
    const users = await listUsersForTenant(tenant.id);

    for (const user of users) {
      if (user.banned) continue;

      const items = await buildHoy(ctx, now, { mine: user.id });
      if (items.length === 0) continue;

      const topThree = items.slice(0, 3).map((item) => item.title).join(" · ");
      await createNotification(ctx, {
        userId: user.id,
        kind: "system",
        title: t("digest.title", { count: items.length }),
        body: topThree,
        url: "/dashboard",
      });
      sent += 1;
    }
  }

  return sent;
}
