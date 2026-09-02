import { env } from "@/lib/config/env";

// Meta Graph API version, shared by every caller in this module (webhook
// media download, send, template sync).
//
// The version used to be hardcoded here (PLAN.md §14 I2 #2). Meta retires
// versions on a published ~2-year schedule, and a retired version does not
// degrade — it stops answering, which means every tenant's WhatsApp stops at
// once. That is a bad thing to discover from a customer. So: the version is
// an env value with a working default, and each known version carries the
// date by which someone has to look at it. Past that date the superadmin
// WhatsApp health page says so, in the one place an operator already checks.

export const GRAPH_API_VERSION = env.WHATSAPP_GRAPH_API_VERSION;
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Ceilings on one Graph API round-trip. Node's fetch otherwise waits up to
 * 300 s for a peer that accepts the socket and goes quiet; on shared hosting
 * a request that does not resolve keeps its Node process alive, and processes
 * count against an account-wide cap. Media downloads get longer because the
 * body is a file, not JSON.
 */
export const GRAPH_TIMEOUT_MS = 15_000;
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * When each version should be revisited — roughly Meta's own two-year
 * retirement horizon for that release, minus a month of margin. A version
 * missing from this map is not an error: it is simply undocumented here, and
 * the health page says that instead of a date.
 */
export const GRAPH_API_VERSION_REVIEW_DATES: Record<string, string> = {
  "v19.0": "2025-05-01",
  "v20.0": "2025-08-01",
  "v21.0": "2026-10-01",
  "v22.0": "2027-01-01",
  "v23.0": "2027-05-01",
};

export type GraphVersionWarning =
  | { kind: "past_review"; version: string; reviewDate: string }
  | { kind: "undocumented"; version: string };

/**
 * The health-page warning, or null while the configured version is still
 * within its documented window. Pure so it can be tested without a clock or
 * a database.
 */
export function graphVersionWarning(
  now: Date = new Date(),
  version: string = GRAPH_API_VERSION,
): GraphVersionWarning | null {
  const reviewDate = GRAPH_API_VERSION_REVIEW_DATES[version];
  if (!reviewDate) return { kind: "undocumented", version };

  // Date-only comparison: the review date is a day, not an instant, and the
  // operator reading this is not counting hours.
  const due = new Date(`${reviewDate}T00:00:00.000Z`);
  if (now.getTime() < due.getTime()) return null;
  return { kind: "past_review", version, reviewDate };
}
