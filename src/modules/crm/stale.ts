/**
 * Days a deal has sat in its current stage, and whether that crosses the
 * stage's own `staleAfterDays` (PLAN.md §15.8 P5). A pure function so the
 * board card and any later reporting compute the same answer, and so the
 * boundary (exactly `staleAfterDays` days — not yet stale; one day more — is)
 * is testable without a database.
 */
export function daysInStage(stageEnteredAt: Date, now: Date = new Date()): number {
  const ms = now.getTime() - stageEnteredAt.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export function isStale(
  stageEnteredAt: Date,
  staleAfterDays: number | null,
  now: Date = new Date(),
): boolean {
  if (staleAfterDays === null) return false;
  return daysInStage(stageEnteredAt, now) > staleAfterDays;
}
