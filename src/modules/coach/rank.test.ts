import { describe, expect, it } from "vitest";
import { isWithinBusinessHours, rankHoy, type HoyCandidate } from "./rank";

// Pure logic (PLAN.md §15.3 L1, §15.8 P7): no DB, so every rule's ordering
// and the `mine` filter are checked without MySQL. hoy.ts's own tests cover
// the reads that build these candidates in the first place.

function candidate(partial: Partial<HoyCandidate> & Pick<HoyCandidate, "kind">): HoyCandidate {
  return {
    assignedUserId: null,
    urgency: 0,
    url: "/x",
    vars: {},
    ...partial,
  };
}

describe("rankHoy", () => {
  it("orders by business severity first: an unread conversation always outranks a stale deal", () => {
    const ranked = rankHoy([
      candidate({ kind: "stale_deal", urgency: 999 }),
      candidate({ kind: "unread_conversation", urgency: 1 }),
    ]);
    expect(ranked.map((item) => item.kind)).toEqual(["unread_conversation", "stale_deal"]);
  });

  it("follows the full kind priority: conversation, task, booking, quote, deal, lead", () => {
    const ranked = rankHoy([
      candidate({ kind: "lead_without_deal" }),
      candidate({ kind: "stale_deal" }),
      candidate({ kind: "unreplied_quote" }),
      candidate({ kind: "upcoming_booking" }),
      candidate({ kind: "overdue_task" }),
      candidate({ kind: "unread_conversation" }),
    ]);
    expect(ranked.map((item) => item.kind)).toEqual([
      "unread_conversation",
      "overdue_task",
      "upcoming_booking",
      "unreplied_quote",
      "stale_deal",
      "lead_without_deal",
    ]);
  });

  it("attaches the fixed severity for each kind", () => {
    const ranked = rankHoy([
      candidate({ kind: "unread_conversation" }),
      candidate({ kind: "stale_deal" }),
      candidate({ kind: "lead_without_deal" }),
    ]);
    const severityOf = (kind: string) => ranked.find((item) => item.kind === kind)!.severity;
    expect(severityOf("unread_conversation")).toBe("high");
    expect(severityOf("stale_deal")).toBe("medium");
    expect(severityOf("lead_without_deal")).toBe("low");
  });

  it("within the same kind, sorts the most urgent first", () => {
    const ranked = rankHoy([
      candidate({ kind: "overdue_task", urgency: 1, vars: { id: "barely" } }),
      candidate({ kind: "overdue_task", urgency: 10, vars: { id: "very" } }),
      candidate({ kind: "overdue_task", urgency: 5, vars: { id: "some" } }),
    ]);
    expect(ranked.map((item) => item.vars.id)).toEqual(["very", "some", "barely"]);
  });

  it("the mine filter keeps only items assigned to that user", () => {
    const ranked = rankHoy(
      [
        candidate({ kind: "overdue_task", assignedUserId: "u1" }),
        candidate({ kind: "overdue_task", assignedUserId: "u2" }),
        candidate({ kind: "stale_deal", assignedUserId: "u1" }),
      ],
      { mine: "u1" },
    );
    expect(ranked).toHaveLength(2);
    expect(ranked.every((item) => item.assignedUserId === "u1")).toBe(true);
  });

  it("the mine filter drops items nobody owns yet, even for the user asking", () => {
    const ranked = rankHoy([candidate({ kind: "lead_without_deal", assignedUserId: null })], {
      mine: "u1",
    });
    expect(ranked).toHaveLength(0);
  });
});

describe("isWithinBusinessHours", () => {
  const TZ = "America/Asuncion";
  const hours = {
    mon: { start: "08:00", end: "18:00" },
    tue: { start: "08:00", end: "18:00" },
    wed: { start: "08:00", end: "18:00" },
    thu: { start: "08:00", end: "18:00" },
    fri: { start: "08:00", end: "18:00" },
    sat: null,
    sun: null,
  };

  it("is always open when the tenant has no configured hours", () => {
    // 2026-02-01 is a Sunday, 03:00 UTC — well outside any reasonable hours.
    expect(isWithinBusinessHours(undefined, new Date("2026-02-01T03:00:00Z"), TZ)).toBe(true);
  });

  it("is inside hours on a weekday afternoon", () => {
    // Asunción is UTC-3 (no DST since 2024): 18:00Z = 15:00 local, a Tuesday.
    expect(isWithinBusinessHours(hours, new Date("2026-02-03T18:00:00Z"), TZ)).toBe(true);
  });

  it("is outside hours before opening, after closing, and on a day with no hours at all", () => {
    // 09:00Z = 06:00 local Tuesday — before the 08:00 open.
    expect(isWithinBusinessHours(hours, new Date("2026-02-03T09:00:00Z"), TZ)).toBe(false);
    // 23:00Z = 20:00 local Tuesday — after the 18:00 close.
    expect(isWithinBusinessHours(hours, new Date("2026-02-03T23:00:00Z"), TZ)).toBe(false);
    // 18:00Z Saturday (2026-01-31) = 15:00 local Saturday — no hours that day.
    expect(isWithinBusinessHours(hours, new Date("2026-01-31T18:00:00Z"), TZ)).toBe(false);
  });
});
