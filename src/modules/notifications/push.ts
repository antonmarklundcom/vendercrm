import webpush, { WebPushError } from "web-push";
import { env } from "@/lib/config/env";

// The web-push transport (PLAN.md §15.5 J2, §15.8 P2).
//
// Deliberately holds no database import: this file is "given these browsers
// and this payload, what happened", which is the half worth testing without a
// MySQL. modules/notifications/subscriptions.ts owns the rows, and jobs.ts
// joins the two.
//
// Unconfigured is a first-class state, not an error (the Resend pattern in
// lib/email). With no VAPID keys the whole feature is hidden: no control
// renders, the subscribe route 404s, and a `push.send` job that somehow
// exists finishes quietly instead of dying five times over.

export type PushTarget = {
  /** `push_subscriptions.id` — what the caller deletes or stamps afterwards. */
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** What the service worker receives. Kept small on purpose: push services cap
 * the encrypted payload (4 KB is the safe assumption) and everything a person
 * actually needs is a line and a place to land. */
export type PushPayload = {
  title: string;
  body?: string | null;
  /** App-relative path the notification click opens. */
  url?: string | null;
  /** Collapses repeats in the tray — same tag replaces rather than stacks. */
  tag?: string | null;
};

export type PushOutcome =
  | { id: string; result: "sent" }
  /** 404/410: the browser revoked or expired this endpoint. The row is dead
   * and the caller deletes it — nothing else in the product refers to it. */
  | { id: string; result: "gone"; status: number }
  /** Anything else — an outage, a rejected payload. The row stays; the caller
   * stamps `failed_at` so a spreading failure is visible. */
  | { id: string; result: "failed"; status: number | null; error: string };

export function isPushConfigured(): boolean {
  return Boolean(env.WEB_PUSH_PUBLIC_KEY && env.WEB_PUSH_PRIVATE_KEY && env.WEB_PUSH_SUBJECT);
}

/** The key a browser subscribes against. Null when the feature is off, which
 * is what every UI in front of this branches on. */
export function pushPublicKey(): string | null {
  return isPushConfigured() ? (env.WEB_PUSH_PUBLIC_KEY as string) : null;
}

/**
 * Applied per send rather than once at module load: `web-push` keeps VAPID
 * details in module state, and setting them at import time would make an
 * unconfigured environment throw while merely *loading* this file — which the
 * settings page does just to ask whether to render a button.
 */
function applyVapid(): void {
  webpush.setVapidDetails(
    env.WEB_PUSH_SUBJECT as string,
    env.WEB_PUSH_PUBLIC_KEY as string,
    env.WEB_PUSH_PRIVATE_KEY as string,
  );
}

/**
 * Sends one payload to every target, and reports what each one did.
 *
 * Never throws and never short-circuits: one dead endpoint must not stop the
 * push to a person's other browser, so the failures come back as data. The
 * sends run in parallel because a person with three devices should not wait
 * for three sequential round-trips to a push service.
 */
export async function deliverToTargets(
  targets: readonly PushTarget[],
  payload: PushPayload,
): Promise<PushOutcome[]> {
  if (targets.length === 0 || !isPushConfigured()) return [];

  applyVapid();
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    url: payload.url ?? "/dashboard",
    tag: payload.tag ?? undefined,
  });

  return Promise.all(
    targets.map(async (target): Promise<PushOutcome> => {
      try {
        await webpush.sendNotification(
          {
            endpoint: target.endpoint,
            keys: { p256dh: target.p256dh, auth: target.auth },
          },
          body,
          // Below the 4 KB payload ceiling either way, but stated so a future
          // longer body fails here rather than at the push service.
          { TTL: 60 * 60 },
        );
        return { id: target.id, result: "sent" };
      } catch (err) {
        const status = statusOf(err);
        if (status === 404 || status === 410) {
          return { id: target.id, result: "gone", status };
        }
        return {
          id: target.id,
          result: "failed",
          status,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}

/** `WebPushError` carries the push service's status code; anything else that
 * escapes the library is a transport failure with no status of its own. */
function statusOf(err: unknown): number | null {
  if (err instanceof WebPushError) return err.statusCode;
  const status = (err as { statusCode?: unknown })?.statusCode;
  return typeof status === "number" ? status : null;
}
