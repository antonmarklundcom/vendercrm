"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Polling revalidation (PLAN.md §6.5): refresh the server-rendered inbox every
// few seconds. No websockets in Phase 1 — the data layer doesn't care, so this
// can be swapped for SSE/WS later without a schema change.
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
