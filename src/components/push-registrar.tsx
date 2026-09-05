"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ensureServiceWorker,
  permissionState,
  pushSupported,
  subscribeToPush,
} from "./push-subscribe";

// Mounted once in the signed-in layout (PLAN.md §15.5 J2, §15.8 P2). Two jobs:
//
//  1. Register the service worker, and re-subscribe a browser that already
//     said yes. That second half matters more than it looks — a subscription
//     the server dropped (a 410 cleanup, a rotated keypair) is invisible to
//     the user, who has already granted permission and believes it works.
//     Re-registering on load is what heals it, and needs no click because the
//     permission is already granted.
//
//  2. Ask, once, on the inbox. Asking is a click's worth of trust and there
//     is exactly one place in this product where a push obviously earns
//     itself — the screen where customer messages arrive.

const DISMISS_KEY = "vc.push-banner-dismissed";
/** Per tab, not per browser: the re-sync below is worth doing once a session,
 * not once a page view — it writes a row. */
const SYNCED_KEY = "vc.push-synced";

export type PushLabels = {
  bannerTitle: string;
  bannerBody: string;
  enable: string;
  dismiss: string;
};

export function PushRegistrar({
  publicKey,
  labels,
}: {
  /** Null when the platform has no VAPID keys — the feature is then simply
   * absent rather than a control that fails when pressed. */
  publicKey: string | null;
  labels: PushLabels;
}) {
  const pathname = usePathname();
  const [showBanner, setShowBanner] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!publicKey || !pushSupported()) return;

    let cancelled = false;
    void (async () => {
      await ensureServiceWorker();
      if (cancelled) return;

      const permission = permissionState();
      if (permission === "granted") {
        // Already trusted us; re-register silently so a browser the server has
        // forgotten starts receiving again. Once per tab session — often
        // enough to heal a dropped row that same visit, rarely enough that
        // opening five pages is not five writes.
        if (!cancelled && !readFlag(SYNCED_KEY)) {
          await subscribeToPush(publicKey);
          writeFlag(SYNCED_KEY, window.sessionStorage);
        }
        return;
      }

      if (permission !== "default") return;
      if (readFlag(DISMISS_KEY)) return;
      if (!cancelled) setShowBanner(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  // Only on the inbox, and only until it is answered either way. Deciding here
  // rather than rendering the banner from the inbox page keeps this whole
  // feature inside one mount point in the layout.
  const onInbox = pathname === "/inbox" || pathname.startsWith("/inbox/");
  if (!publicKey || !showBanner || !onInbox) return null;

  async function handleEnable() {
    if (!publicKey) return;
    setBusy(true);
    await subscribeToPush(publicKey);
    // Dismissed either way: a refusal must not re-ask on the next page view,
    // and a browser-level "block" cannot be undone from here anyway. Settings
    // keeps the control for whenever they change their mind.
    dismiss();
    setShowBanner(false);
    setBusy(false);
  }

  function dismiss() {
    writeFlag(DISMISS_KEY, window.localStorage);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border bg-card px-3 py-2 md:hidden">
      <Bell className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{labels.bannerTitle}</p>
        <p className="text-xs text-muted-foreground">{labels.bannerBody}</p>
      </div>
      <Button type="button" size="sm" onClick={handleEnable} disabled={busy}>
        {labels.enable}
      </Button>
      <button
        type="button"
        onClick={() => {
          dismiss();
          setShowBanner(false);
        }}
        aria-label={labels.dismiss}
        className="rounded-md p-1 text-muted-foreground hover:bg-muted"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Storage can throw outright in private mode and with site data blocked, and
 * neither the banner nor the re-sync is worth a crash — an unreadable flag
 * just means "not set yet". */
function readFlag(key: string): boolean {
  try {
    return (
      window.localStorage.getItem(key) === "1" || window.sessionStorage.getItem(key) === "1"
    );
  } catch {
    return false;
  }
}

function writeFlag(key: string, store: Storage): void {
  try {
    store.setItem(key, "1");
  } catch {
    // The banner reappears next visit, which is worse than remembering but
    // not broken.
  }
}
