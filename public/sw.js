// Service worker for web push (PLAN.md §15.5 J2, §15.8 P2).
//
// Push only. No fetch handler, no caching, no offline mode — that is a
// separate decision with its own failure modes (a stale bundle served to a rep
// after a deploy), and this pass does not make it. A service worker with no
// fetch listener is skipped by the browser for navigation, so installing this
// changes nothing about how the app loads.
//
// Served from /sw.js so its scope is the whole origin, which is what lets a
// notification click focus a tab already open anywhere in the app.

// A new worker takes over on the next page load rather than waiting for every
// tab to close: this file changes rarely, and when it does it is because
// notifications were broken.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const DEFAULT_URL = "/dashboard";
const ICON = "/icon-192.png";
const BADGE = "/icon-192.png";

self.addEventListener("push", (event) => {
  // A push with no readable payload still deserves a notification: on most
  // platforms the permission is revoked if a push event shows nothing, and a
  // vague "tenés un aviso" is better than losing the permission entirely.
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = typeof data.title === "string" && data.title ? data.title : "clientes.com.py";
  const url = typeof data.url === "string" && data.url ? data.url : DEFAULT_URL;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: ICON,
      badge: BADGE,
      // Same tag replaces rather than stacks — four messages in one
      // conversation are one line in the tray (see modules/notifications).
      tag: typeof data.tag === "string" && data.tag ? data.tag : undefined,
      // The click handler needs the destination, and `data` is the only part
      // of a notification that survives into `notificationclick`.
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || DEFAULT_URL;

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Focus a tab that is already on the app and take it there, rather than
      // opening a second copy of an installed PWA. Matching on origin, not on
      // the exact URL: a rep with the inbox open should land on the right
      // conversation in the window they already have.
      const absolute = new URL(target, self.location.origin);
      for (const client of clientList) {
        if (new URL(client.url).origin !== absolute.origin) continue;
        await client.focus();
        if ("navigate" in client) {
          await client.navigate(absolute.href).catch(() => {});
        }
        return;
      }

      await self.clients.openWindow(absolute.href);
    })(),
  );
});
