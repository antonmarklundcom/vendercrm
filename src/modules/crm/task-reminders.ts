import { buildSystemTenantContext, type TenantContext } from "@/modules/tenancy/context";
import { listTenants } from "@/modules/tenancy/tenants";
import { listUsersForTenant } from "@/modules/tenancy/users";
import { getContact } from "@/modules/crm/contacts";
import { listOpenTasksDueBy } from "@/modules/crm/tasks";
import { listCalendarEvents, type CalendarEvent } from "@/modules/calendar/events";
import { createNotification } from "@/modules/notifications/notifications";
import { getTranslator } from "@/lib/i18n/translator";
import { sendEmail } from "@/lib/email";
import { taskRemindersEmail } from "@/lib/email/templates";
import { env } from "@/lib/config/env";
import { reportError } from "@/lib/observability";

// The daily reminder (PLAN.md §13 H6). listOpenTasksDueBy has existed since
// the tasks work landed and nothing ever called it outside the dashboard — a
// task due yesterday sat there until someone happened to look.
//
// It now carries the day's appointments too. A visit at nine tomorrow is
// exactly the thing a reminder exists for, and it arrives in the same mail
// rather than a second one: two daily emails from the same product is how
// both get filtered.
//
// One email per user per run, listing only *their* work: a shared digest of
// the whole tenant's day is a digest everyone ignores. Users who opted out
// (users.task_reminders) are skipped, and a user with nothing due and nothing
// booked gets nothing — an empty reminder is how a daily email becomes noise.

export type TaskReminderResult = {
  usersEmailed: number;
  tasksListed: number;
  appointmentsListed: number;
};

/** How far ahead the mail looks for appointments — one run's worth. */
export const APPOINTMENT_HORIZON_MS = 24 * 60 * 60 * 1000;

/**
 * The appointments that belong in one person's reminder.
 *
 * Assigned to them, or unassigned but theirs — somebody who books a visit
 * without naming an owner still means themselves, and mailing an unassigned
 * appointment to the whole business would make the reminder noise for
 * everyone else. Overlap rather than start time, for the same reason the
 * grid uses it: a visit already under way at send time is still today's.
 */
export function appointmentsForUser<
  T extends Pick<CalendarEvent, "assignedUserId" | "createdByUserId" | "startsAt" | "endsAt">,
>(events: T[], userId: string, from: Date, to: Date): T[] {
  return events
    .filter((event) =>
      event.assignedUserId
        ? event.assignedUserId === userId
        : event.createdByUserId === userId,
    )
    .filter(
      (event) => event.startsAt.getTime() < to.getTime() && event.endsAt.getTime() > from.getTime(),
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export async function sendTaskReminders(now: Date = new Date()): Promise<TaskReminderResult> {
  const result: TaskReminderResult = { usersEmailed: 0, tasksListed: 0, appointmentsListed: 0 };
  const horizon = new Date(now.getTime() + APPOINTMENT_HORIZON_MS);

  for (const tenant of await listTenants()) {
    // Reminders are work *about* the tenant's data, not writes to it, so a
    // grace-period tenant still gets them — being read-only doesn't make a
    // customer callback less due.
    const ctx = await buildSystemTenantContext(tenant.id);
    if (!ctx) continue;

    try {
      const [due, booked] = await Promise.all([
        listOpenTasksDueBy(ctx, now),
        listCalendarEvents(ctx, now, horizon),
      ]);
      if (due.length === 0 && booked.length === 0) continue;

      const users = await listUsersForTenant(tenant.id);

      for (const user of users) {
        if (!user.email || user.banned || !user.taskReminders) continue;

        const mine = due.filter((task) => task.assignedUserId === user.id);
        const appointments = appointmentsForUser(booked, user.id, now, horizon);
        if (mine.length === 0 && appointments.length === 0) continue;

        const items = await Promise.all(
          mine.map(async (task) => {
            const contact = task.contactId ? await getContact(ctx, task.contactId) : null;
            return {
              title: task.title,
              dueAt: task.dueAt,
              overdue: task.dueAt.getTime() < now.getTime(),
              contactName: contact?.name ?? null,
              url: task.contactId ? `${env.APP_URL}/contacts/${task.contactId}` : env.APP_URL,
            };
          }),
        );

        const appointmentItems = await Promise.all(
          appointments.map(async (event) => {
            const contact = event.contactId ? await getContact(ctx, event.contactId) : null;
            return {
              title: event.title,
              startsAt: event.startsAt,
              allDay: event.allDay,
              location: event.location,
              contactName: contact?.name ?? null,
              url: `${env.APP_URL}/calendar/${event.id}`,
            };
          }),
        );

        const { subject, html } = await taskRemindersEmail({
          userName: user.name,
          items,
          appointments: appointmentItems,
          tasksUrl: `${env.APP_URL}/dashboard`,
          locale: user.locale ?? tenant.locale,
        });

        const sent = await sendEmail({ to: user.email, subject, html });
        if (sent) result.usersEmailed += 1;
        result.tasksListed += mine.length;
        result.appointmentsListed += appointments.length;

        // The same reminder, on the phone (PLAN.md §15.5 J2). One row per run
        // rather than one per task: this is the daily "here is your day", and
        // a bell with eleven separate entries for eleven follow-ups is a bell
        // nobody opens. The row is what carries it — the push comes off it.
        await notifyDueWork(ctx, user, mine.length, appointments.length, tenant.locale);
      }
    } catch (err) {
      // One tenant's failure must not stop everyone else's reminders.
      reportError(err, { tags: { area: "task-reminders" }, extra: { tenantId: tenant.id } });
    }
  }

  return result;
}

/**
 * The in-app half of the daily reminder, added with web push (PLAN.md §15.5
 * J2). Never allowed to break the mail run: a tenant whose notification write
 * fails must still get its email, and the next tenant must still get its own.
 */
async function notifyDueWork(
  ctx: TenantContext,
  user: { id: string; locale: string | null },
  taskCount: number,
  appointmentCount: number,
  tenantLocale: string | null,
): Promise<void> {
  // A suspended tenant is read-only (§10 1C), so there is no row to write —
  // the email above still goes out, which is the half that matters.
  if (ctx.accessStatus !== "active") return;

  try {
    const t = await getTranslator(user.locale ?? tenantLocale, "app.push");
    await createNotification(ctx, {
      userId: user.id,
      kind: "task_due",
      title: t("taskDueTitle"),
      body: t("taskDueBody", { tasks: taskCount, appointments: appointmentCount }),
      url: "/dashboard",
    });
  } catch (err) {
    reportError(err, {
      tags: { area: "task-reminders", step: "notification" },
      extra: { tenantId: ctx.tenantId, userId: user.id },
    });
  }
}
