import { and, desc, eq, isNull, type SQL } from "drizzle-orm";
import { notifications } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { enqueuePush } from "./queue";

// In-app notifications (PLAN.md §15.5 J1, §15.8 P1; web push added in P2).
//
// The row is the notification; delivery is a separate concern. Web push hangs
// off `createNotification` — a push is a second copy of something already
// durable here, which is what makes "the push failed" a cosmetic problem
// rather than a lost message. Nothing else has to remember to buzz the phone:
// writing the row is what does it, so a kind added by a later phase is
// delivered without touching this file.

export type NotificationRow = typeof notifications.$inferSelect;

export type CreateNotificationInput = {
  userId: string;
  kind?: NotificationRow["kind"];
  title: string;
  body?: string | null;
  /** App-relative path the bell links to, e.g. `/contacts/01J…`. */
  url?: string | null;
  flowRunId?: string;
};

export async function createNotification(
  ctx: TenantContext,
  input: CreateNotificationInput,
): Promise<NotificationRow | null> {
  const id = newId();
  await tenantDb(ctx)
    .insert(notifications)
    .values({
      id,
      userId: input.userId,
      kind: input.kind ?? "system",
      title: input.title.slice(0, 200),
      body: input.body ?? null,
      url: input.url?.slice(0, 500) ?? null,
      flowRunId: input.flowRunId ?? null,
    });

  const row = await getNotification(ctx, id);
  if (row) await pushFor(ctx, row);
  return row;
}

/**
 * The push half. Deliberately after the insert and deliberately swallowing:
 * the row is what the product promised, and a queue that refuses the job must
 * not turn a delivered notification into a failed automation step.
 */
async function pushFor(ctx: TenantContext, row: NotificationRow): Promise<void> {
  try {
    await enqueuePush(ctx.tenantId, row.userId, row.kind, {
      title: row.title,
      body: row.body,
      url: row.url,
    });
  } catch (err) {
    const { reportError } = await import("@/lib/observability");
    reportError(err, { tags: { area: "notifications" }, extra: { notificationId: row.id } });
  }
}

export async function getNotification(
  ctx: TenantContext,
  id: string,
): Promise<NotificationRow | null> {
  const [row] = await tenantDb(ctx).select(notifications, eq(notifications.id, id)).limit(1);
  return row ?? null;
}

/** Newest first — the bell shows the top of this list and nothing else. */
export async function listNotifications(
  ctx: TenantContext,
  userId: string,
  limit = 20,
): Promise<NotificationRow[]> {
  return tenantDb(ctx)
    .select(notifications, eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function countUnread(ctx: TenantContext, userId: string): Promise<number> {
  const rows = await tenantDb(ctx).select(
    notifications,
    and(eq(notifications.userId, userId), isNull(notifications.readAt)) as SQL,
  );
  return rows.length;
}

/**
 * Marking read is scoped to the *acting* user, not to an id the caller
 * chose: a notification belongs to one person, and no request should be
 * able to clear somebody else's bell.
 */
export async function markRead(ctx: TenantContext, userId: string, id: string): Promise<void> {
  await tenantDb(ctx)
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)) as SQL);
}

export async function markAllRead(ctx: TenantContext, userId: string): Promise<void> {
  await tenantDb(ctx)
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)) as SQL);
}
