import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireSession } from "@/lib/api/guards";
import { isPushConfigured } from "@/modules/notifications/push";
import {
  MAX_ENDPOINT_LENGTH,
  MAX_KEY_LENGTH,
  deleteSubscriptionForUser,
  saveSubscription,
} from "@/modules/notifications/subscriptions";

// Registering and forgetting a browser for web push (PLAN.md §15.5 J2, §15.8
// P2). Session-authenticated: the tenant and the user come from the session,
// never from the body, so there is nothing here for a caller to point at
// somebody else's account.

const subscribeSchema = z.object({
  endpoint: z.string().url().max(MAX_ENDPOINT_LENGTH),
  keys: z.object({
    p256dh: z.string().min(1).max(MAX_KEY_LENGTH),
    auth: z.string().min(1).max(MAX_KEY_LENGTH),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(MAX_ENDPOINT_LENGTH),
});

/** With no VAPID keys the feature does not exist, and saying so is more
 * useful than accepting a subscription nothing will ever send to. The UI
 * never calls this in that state — it has already been told there is no
 * public key to subscribe against. */
const notConfigured = () => apiError("not_found", 404, "push_not_configured");

export async function POST(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  if (!isPushConfigured()) return notConfigured();
  // Registering a browser is a write, and a suspended tenant is read-only
  // (§10 1C). Refused cleanly rather than left to throw out of tenantDb.
  if (ctx.accessStatus !== "active") return apiError("forbidden", 403, "tenant_not_writable");

  const parsed = subscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_request", 400);

  await saveSubscription(ctx, ctx.userId, {
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
}

/**
 * Forgetting this browser. Scoped to the signed-in user rather than keyed on
 * the endpoint alone: unlike the 410 cleanup — where the push service itself
 * is the one saying the endpoint is dead — this is a request, and a request
 * may only delete its own sender's row.
 *
 * Unsubscribing is allowed on a suspended tenant. Turning notifications *off*
 * is the one write a read-only account should never be made to argue about.
 */
export async function DELETE(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  const parsed = unsubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_request", 400);

  await deleteSubscriptionForUser(ctx, ctx.userId, parsed.data.endpoint);

  return NextResponse.json({ ok: true });
}
