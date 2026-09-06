import { dayKeyOf, weekdayOf, zonedParts } from "@/modules/calendar/zoned-time";
import type { BusinessHours } from "@/modules/tenancy/settings";

// The "Hoy" panel's ranking (PLAN.md §15.3 L1, §15.8 P7) — pure and
// DB-free on purpose, so every rule and the ordering across rules can be
// unit tested without MySQL. `modules/coach/hoy.ts` does the reading and
// the i18n; this file only decides what belongs on the list and in what
// order.

export type HoyItemKind =
  | "unread_conversation"
  | "overdue_task"
  | "upcoming_booking"
  | "unreplied_quote"
  | "stale_deal"
  | "lead_without_deal";

export type HoySeverity = "high" | "medium" | "low";

/** Business severity per kind — fixed, not computed per row: what kind of
 *  problem this is matters more than how bad today's instance happens to
 *  be. Doubles as the between-kind sort order below. */
const KIND_ORDER: Record<HoyItemKind, { severity: HoySeverity; rank: number }> = {
  // A customer is waiting on a WhatsApp-first CRM — nothing outranks that.
  unread_conversation: { severity: "high", rank: 0 },
  // A promise already broken.
  overdue_task: { severity: "high", rank: 1 },
  // A no-show risk inside the next 24h, still preventable.
  upcoming_booking: { severity: "high", rank: 2 },
  // Money on the table, but the sales cycle is slower than a chat reply.
  unreplied_quote: { severity: "medium", rank: 3 },
  // Pipeline hygiene — real, but nothing is on fire.
  stale_deal: { severity: "medium", rank: 4 },
  // Earliest-stage opportunity; nobody has even started working it.
  lead_without_deal: { severity: "low", rank: 5 },
};

export type HoyCandidate = {
  kind: HoyItemKind;
  /** Who this belongs to, for the `mine` filter — null means nobody owns it
   *  yet (an unassigned conversation, a lead with no deal), which `mine`
   *  always excludes since it isn't anyone's yet. */
  assignedUserId: string | null;
  /** Higher sorts first within the same kind — minutes waited, days overdue,
   *  days stale, or (for a countdown, like an upcoming booking) the inverse
   *  of time remaining. */
  urgency: number;
  url: string;
  /** Passed straight to next-intl as the interpolation values for this
   *  kind's title/subtitle/action keys. */
  vars: Record<string, string | number>;
};

export type HoyRankedCandidate = HoyCandidate & { severity: HoySeverity };

export type RankHoyOptions = {
  /** Restrict to items assigned to this user — the dashboard's "mine" toggle
   *  and the per-user morning push both use it. */
  mine?: string;
};

/** Combines every rule's candidates into the one ranked, optionally
 *  filtered, list `hoy.ts` renders. */
export function rankHoy(
  candidates: HoyCandidate[],
  options: RankHoyOptions = {},
): HoyRankedCandidate[] {
  const scoped = options.mine
    ? candidates.filter((candidate) => candidate.assignedUserId === options.mine)
    : candidates;

  return scoped
    .map((candidate) => ({ ...candidate, severity: KIND_ORDER[candidate.kind].severity }))
    .sort((a, b) => {
      const rankDiff = KIND_ORDER[a.kind].rank - KIND_ORDER[b.kind].rank;
      if (rankDiff !== 0) return rankDiff;
      return b.urgency - a.urgency;
    });
}

const WEEKDAY_KEYS: (keyof BusinessHours)[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** A tenant with no configured hours is treated as always open — the same
 *  "nothing configured yet" default the rest of the product uses rather
 *  than silently going quiet on a fresh account. */
export function isWithinBusinessHours(
  hours: BusinessHours | undefined,
  now: Date,
  timeZone: string,
): boolean {
  if (!hours) return true;

  const day = dayKeyOf(now, timeZone);
  const today = hours[WEEKDAY_KEYS[weekdayOf(day)]];
  if (!today) return false;

  const { hour, minute } = zonedParts(now, timeZone);
  const nowMinutes = hour * 60 + minute;
  const [startH, startM] = today.start.split(":").map(Number);
  const [endH, endM] = today.end.split(":").map(Number);
  return nowMinutes >= startH * 60 + startM && nowMinutes <= endH * 60 + endM;
}
