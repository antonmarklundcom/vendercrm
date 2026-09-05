import { and, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import type { PushOutcome, PushTarget } from "./push";

// The `push_subscriptions` rows (PLAN.md §15.5 J2, §15.8 P2). Everything here
// is scoped through tenantDb; the transport half lives in ./push.ts.

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

export type SaveSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
};

/** Longest values the columns hold — the route validates against these so a
 * long endpoint is a 400 the browser can see rather than a truncated row that
 * silently never delivers. */
export const MAX_ENDPOINT_LENGTH = 500;
export const MAX_KEY_LENGTH = 255;

/**
 * Records a browser, or refreshes the one already there.
 *
 * The endpoint is the identity (see the schema comment), and it is unique
 * platform-wide rather than per tenant — a browser is one browser. So a
 * re-subscribe by the same person updates in place, and a re-subscribe after
 * signing in as somebody else *moves* the row: the previous owner stops
 * receiving pushes on a device that is no longer theirs, which is the only
 * safe reading of a shared phone. Emptying and reinserting rather than an
 * upsert keeps that move honest — the row's tenant and user are rewritten
 * together, and `created_at` genuinely means "since this person had it".
 */
export async function saveSubscription(
  ctx: TenantContext,
  userId: string,
  input: SaveSubscriptionInput,
): Promise<void> {
  // Not through tenantDb: the row being replaced may belong to another
  // tenant, which is exactly the case this is here to handle. Deleting by
  // endpoint gives away nothing — the caller already holds the endpoint.
  await deleteSubscriptionByEndpoint(input.endpoint);

  await tenantDb(ctx)
    .insert(pushSubscriptions)
    .values({
      id: newId(),
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent?.slice(0, MAX_KEY_LENGTH) ?? null,
      lastSeenAt: new Date(),
    });
}

/** The unsubscribe half of the route, and what a `gone` outcome triggers.
 * Keyed by endpoint alone for the reason above: whoever holds the endpoint is
 * the browser it belongs to. */
export async function deleteSubscriptionByEndpoint(endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function listSubscriptionsForUser(
  ctx: TenantContext,
  userId: string,
): Promise<PushSubscriptionRow[]> {
  return tenantDb(ctx).select(pushSubscriptions, eq(pushSubscriptions.userId, userId));
}

/** Whether this person has any browser registered — what the settings control
 * shows as "activo en N dispositivos". */
export async function countSubscriptionsForUser(
  ctx: TenantContext,
  userId: string,
): Promise<number> {
  return (await listSubscriptionsForUser(ctx, userId)).length;
}

export function toTargets(rows: readonly PushSubscriptionRow[]): PushTarget[] {
  return rows.map((row) => ({
    id: row.id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
  }));
}

/**
 * Applies what a round of sends learned: `gone` endpoints are deleted, failed
 * ones stamped, successful ones refreshed.
 *
 * The deletion is the load-bearing half. A subscription that answers 410 will
 * answer 410 forever, and leaving it costs a doomed HTTP request on every
 * notification for that user, for the life of the row.
 */
export async function applyOutcomes(
  ctx: TenantContext,
  outcomes: readonly PushOutcome[],
): Promise<void> {
  // A suspended tenant is read-only at the tenantDb layer (§10 1C), and a
  // push that went out is not worth turning into a thrown job. The rows stay
  // as they are until the tenant is active again — bookkeeping, not delivery.
  if (ctx.accessStatus !== "active") return;

  const gone = outcomes.filter((o) => o.result === "gone").map((o) => o.id);
  const failed = outcomes.filter((o) => o.result === "failed").map((o) => o.id);
  const sent = outcomes.filter((o) => o.result === "sent").map((o) => o.id);

  if (gone.length > 0) {
    await tenantDb(ctx).delete(pushSubscriptions, inArray(pushSubscriptions.id, gone) as SQL);
  }
  if (failed.length > 0) {
    await tenantDb(ctx)
      .update(pushSubscriptions)
      .set({ failedAt: new Date() })
      .where(inArray(pushSubscriptions.id, failed) as SQL);
  }
  if (sent.length > 0) {
    await tenantDb(ctx)
      .update(pushSubscriptions)
      .set({ lastSeenAt: new Date(), failedAt: null })
      .where(inArray(pushSubscriptions.id, sent) as SQL);
  }
}

/** Every browser belonging to a set of people — the fan-out's one query,
 * rather than one per recipient. */
export async function listSubscriptionsForUsers(
  ctx: TenantContext,
  userIds: readonly string[],
): Promise<PushSubscriptionRow[]> {
  if (userIds.length === 0) return [];
  return tenantDb(ctx).select(
    pushSubscriptions,
    inArray(pushSubscriptions.userId, [...userIds]) as SQL,
  );
}

/**
 * "Desactivar en este dispositivo" — the browser hands back its endpoint and
 * the row goes away.
 *
 * Ownership is proved with a tenant-scoped read first, so this can only ever
 * remove the caller's own row; the delete itself then bypasses tenantDb on
 * purpose. Switching notifications *off* is the one operation a suspended,
 * read-only tenant (§10 1C) must never be refused — nobody should have to
 * settle an unpaid invoice to stop their phone buzzing.
 */
export async function deleteSubscriptionForUser(
  ctx: TenantContext,
  userId: string,
  endpoint: string,
): Promise<void> {
  const [row] = await tenantDb(ctx).select(
    pushSubscriptions,
    and(
      eq(pushSubscriptions.userId, userId),
      eq(pushSubscriptions.endpoint, endpoint),
    ) as SQL,
  );
  if (!row) return;

  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
}
