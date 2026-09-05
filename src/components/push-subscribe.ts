"use client";

// The browser half of web push (PLAN.md §15.5 J2, §15.8 P2), shared by the
// settings control and the inbox banner so both go through exactly one
// permission flow. Nothing here renders — it is the four things a browser can
// do about a push subscription, and the two calls to our own API.

export const SW_PATH = "/sw.js";
export const SUBSCRIBE_URL = "/api/push/subscribe";

/** Every piece has to be there: iOS Safari has `Notification` but no
 * `PushManager` outside an installed PWA, and Firefox on Android has all
 * three. Feature detection rather than UA sniffing, so a browser that gains
 * support gains the feature. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function permissionState(): NotificationPermission | null {
  return pushSupported() ? Notification.permission : null;
}

/** Registers (or returns) the worker. Safe to call on every page load — the
 * browser treats a repeat registration of the same script as a no-op. */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
  } catch {
    // A blocked or unavailable worker (private mode, an enterprise policy) is
    // a feature that isn't there, not an error to show somebody mid-task.
    return null;
  }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

export type SubscribeResult = "subscribed" | "denied" | "unsupported" | "failed";

/**
 * Asks for permission, subscribes, and tells the server.
 *
 * Must be called from a click: Chrome refuses `Notification.requestPermission`
 * without a user gesture, which is the whole reason there is a button in
 * settings and a banner on the inbox rather than a prompt on page load.
 *
 * Re-subscribing when a subscription already exists is deliberate and cheap —
 * it is how a browser whose row was deleted server-side (a 410 cleanup, a key
 * rotation) gets itself recorded again.
 */
export async function subscribeToPush(publicKey: string): Promise<SubscribeResult> {
  if (!pushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  try {
    const registration = await ensureServiceWorker();
    if (!registration) return "failed";
    // A worker that is registered but not yet active cannot be subscribed
    // against — on a first visit that is the normal case.
    await navigator.serviceWorker.ready;

    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        // Non-negotiable on Chrome: a push the user cannot see is not allowed.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    const response = await fetch(SUBSCRIBE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!response.ok) return "failed";

    return "subscribed";
  } catch {
    return "failed";
  }
}

/** Drops the browser's subscription and the row behind it. The browser side
 * goes first: if the server call fails, the next push simply finds a dead
 * endpoint and the 410 cleanup removes the row anyway. */
export async function unsubscribeFromPush(): Promise<boolean> {
  const subscription = await currentSubscription();
  if (!subscription) return true;

  const { endpoint } = subscription;
  try {
    await subscription.unsubscribe();
    await fetch(SUBSCRIBE_URL, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * VAPID keys travel as base64url; `applicationServerKey` wants raw bytes.
 * (`atob` handles standard base64 only, hence the substitution and padding.)
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
