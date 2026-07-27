"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Inbox polling (PLAN.md §6.5: "polling every 5s on the active view. No
 * websockets in Phase 1 — Hostinger single-process + this team size doesn't
 * justify it").
 *
 * router.refresh() re-runs the server component, so new messages appear
 * without a full navigation. Polling pauses while the tab is hidden — an
 * inbox left open overnight would otherwise keep one request per 5s going
 * against a single-process server for no one's benefit.
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}
