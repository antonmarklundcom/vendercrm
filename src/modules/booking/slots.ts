import type { BusinessHours, DayHours } from "@/modules/tenancy/settings";
import { addDays, weekdayOf, zonedTimeToUtc, type DayKey } from "@/modules/calendar/zoned-time";

// Slot generation (docs/SPEC-BOOKING.md §4). Pure on purpose: it takes data
// and a clock rather than a TenantContext, so every rule below is unit
// testable with no database and no wall clock — the shape calendar/grid.ts,
// sites/alerts.ts and lib/object-path already established in this repo.
//
// The one thing worth saying twice: `busy` is *every* calendar event the
// resource has, not only the ones bookings produced. That is what makes
// "synced with the agenda" true rather than aspirational, and it is why no
// sync job exists in either direction.

const DAY_KEYS: Array<keyof BusinessHours> = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export type AvailabilityRule = {
  resourceId: string;
  /** 0 = Sunday, matching `weekdayOf`. */
  weekday: number;
  /** Local wall clock, "HH:MM". */
  start: string;
  end: string;
};

export type BusyInterval = {
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
};

export type Blackout = {
  /** Null blacks out every resource — a public holiday, not a vacation. */
  resourceId: string | null;
  startsAt: Date;
  endsAt: Date;
};

/**
 * Seats already taken at one exact start, for the type being generated.
 *
 * Capacity is deliberately *not* expressed as a busy interval. A busy
 * interval is "this resource is unavailable", which is true of a rep's site
 * visit and false of the four people already signed up for a spinning class
 * that fits twelve. Overlap and capacity are different questions, so they
 * are different inputs — and a booking of a *different* type, or of the same
 * type at a different start, is still an ordinary hard block.
 */
export type SeatUsage = {
  resourceId: string;
  startsAt: Date;
  seats: number;
};

export type SlotTypeConfig = {
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  slotIncrementMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  maxPerDay?: number | null;
  /**
   * How many places one start holds. 1 — the default — reproduces the
   * pre-capacity behaviour exactly: one seat taken at a start fills it.
   */
  capacity?: number;
};

export type GenerateSlotsInput = {
  timeZone: string;
  from: DayKey;
  to: DayKey;
  type: SlotTypeConfig;
  rules: AvailabilityRule[];
  /** The tenant-wide ceiling. A slot must satisfy this *and* a rule. */
  businessHours: BusinessHours | null;
  busy: BusyInterval[];
  /** Only meaningful when `type.capacity` > 1; empty is the ordinary case. */
  seatsTaken?: SeatUsage[];
  blackouts: Blackout[];
  now: Date;
};

export type Slot = {
  startsAt: Date;
  endsAt: Date;
  /** Every resource free at this start; assignment picks one at booking time. */
  resourceIds: string[];
  /**
   * Places left at this start, across the offered resources — the most any
   * one of them can still take. 1 for an ordinary one-at-a-time type, which
   * is what every caller that ignores this field assumes.
   */
  seatsRemaining: number;
};

/** "HH:MM" → minutes since local midnight. */
export function minutesOfDay(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

function fromMinutes(total: number): string {
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

type Window = { start: number; end: number };

function intersect(a: Window, b: Window): Window | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

/**
 * The tenant's business hours for a weekday, as a window in local minutes.
 *
 * `undefined` here means "no business hours configured at all", which the
 * caller treats as no ceiling — a tenant who never filled that form in should
 * not find their booking page empty. `null` means the tenant explicitly
 * closed that day, and closed is closed.
 */
export function businessWindowFor(
  hours: BusinessHours | null,
  weekday: number,
): Window | null | undefined {
  if (!hours) return undefined;
  const key = DAY_KEYS[weekday];
  const day: DayHours | undefined = key ? hours[key] : undefined;
  if (day === undefined) return undefined;
  if (day === null) return null;
  return { start: minutesOfDay(day.start), end: minutesOfDay(day.end) };
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Slots for `from..to`, oldest first.
 *
 * A resource with **no rules at all** offers nothing. That is the opposite of
 * `isWithinBusinessHours`'s "unconfigured means always open" and deliberately
 * so: an unconfigured automation condition must not stop automations, but an
 * unconfigured public page must never offer a stranger 3 a.m. on a Sunday.
 */
export function generateSlots(input: GenerateSlotsInput): Slot[] {
  const { timeZone, type, now } = input;
  const increment = Math.max(1, type.slotIncrementMinutes || type.durationMinutes);
  const earliest = now.getTime() + type.minNoticeMinutes * 60_000;
  const capacity = Math.max(1, type.capacity ?? 1);
  // The horizon counts from today where the tenant is, never from the window
  // the visitor asked for — otherwise paging to next month would slide the
  // horizon forward with them and `maxAdvanceDays` would mean nothing.
  const lastDay = addDays(localDayOf(now, timeZone), type.maxAdvanceDays);

  const rulesByResource = new Map<string, AvailabilityRule[]>();
  for (const rule of input.rules) {
    const list = rulesByResource.get(rule.resourceId) ?? [];
    list.push(rule);
    rulesByResource.set(rule.resourceId, list);
  }

  // Grouped by exact start instant, so two free reps produce one offered slot
  // carrying both — the visitor picks a time, not a person.
  const byStart = new Map<number, Slot>();
  const perDayCount = new Map<string, number>();

  for (let day = input.from; day <= input.to; day = addDays(day, 1)) {
    if (day > lastDay) break;
    const weekday = weekdayOf(day);
    const business = businessWindowFor(input.businessHours, weekday);
    // An explicitly closed day is closed for every resource on it.
    if (business === null) continue;

    for (const [resourceId, rules] of rulesByResource) {
      for (const rule of rules) {
        if (rule.weekday !== weekday) continue;

        const ruleWindow = { start: minutesOfDay(rule.start), end: minutesOfDay(rule.end) };
        const window = business ? intersect(ruleWindow, business) : ruleWindow;
        if (!window) continue;

        for (
          let startMinute = window.start;
          startMinute + type.durationMinutes <= window.end;
          startMinute += increment
        ) {
          // Buffers are the resource's time, not the customer's: the slot the
          // visitor sees is `duration`, but it must fit with both buffers
          // inside the availability window.
          if (startMinute - type.bufferBeforeMinutes < window.start) continue;
          if (startMinute + type.durationMinutes + type.bufferAfterMinutes > window.end) continue;

          const startsAt = zonedTimeToUtc(day, fromMinutes(startMinute), timeZone);
          const endsAt = new Date(startsAt.getTime() + type.durationMinutes * 60_000);

          if (startsAt.getTime() < earliest) continue;

          const blockedStart = startsAt.getTime() - type.bufferBeforeMinutes * 60_000;
          const blockedEnd = endsAt.getTime() + type.bufferAfterMinutes * 60_000;

          const isBusy = input.busy.some(
            (entry) =>
              entry.resourceId === resourceId &&
              overlaps(blockedStart, blockedEnd, entry.startsAt.getTime(), entry.endsAt.getTime()),
          );
          if (isBusy) continue;

          const isBlackedOut = input.blackouts.some(
            (entry) =>
              (entry.resourceId === null || entry.resourceId === resourceId) &&
              overlaps(blockedStart, blockedEnd, entry.startsAt.getTime(), entry.endsAt.getTime()),
          );
          if (isBlackedOut) continue;

          // Capacity, second and separately: the resource is free, but the
          // class may be full. At capacity 1 this is the same sentence as
          // "somebody already booked this exact start", which is why that
          // booking is counted here rather than passed in as busy.
          const taken = (input.seatsTaken ?? []).reduce(
            (sum, entry) =>
              entry.resourceId === resourceId &&
              entry.startsAt.getTime() === startsAt.getTime()
                ? sum + entry.seats
                : sum,
            0,
          );
          const remaining = capacity - taken;
          if (remaining <= 0) continue;

          const key = startsAt.getTime();
          const existing = byStart.get(key);
          if (existing) {
            if (!existing.resourceIds.includes(resourceId)) existing.resourceIds.push(resourceId);
            // Across resources the honest number is the roomiest one: that
            // is how many places a visitor can actually still buy here.
            existing.seatsRemaining = Math.max(existing.seatsRemaining, remaining);
          } else {
            byStart.set(key, {
              startsAt,
              endsAt,
              resourceIds: [resourceId],
              seatsRemaining: remaining,
            });
            perDayCount.set(day, (perDayCount.get(day) ?? 0) + 1);
          }
        }
      }
    }
  }

  const slots = [...byStart.values()].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  // Resource order must not depend on Map insertion order, or round-robin
  // would be untestable and the same query could answer differently twice.
  for (const slot of slots) slot.resourceIds.sort();

  if (!type.maxPerDay) return slots;
  return capPerDay(slots, timeZone, type.maxPerDay);
}

function capPerDay(slots: Slot[], timeZone: string, maxPerDay: number): Slot[] {
  const seen = new Map<string, number>();
  const kept: Slot[] = [];
  for (const slot of slots) {
    // Local day, not UTC day: a 22:00 slot in Asunción belongs to that
    // Tuesday even though the instant is already Wednesday in UTC.
    const day = localDayOf(slot.startsAt, timeZone);
    const count = seen.get(day) ?? 0;
    if (count >= maxPerDay) continue;
    seen.set(day, count + 1);
    kept.push(slot);
  }
  return kept;
}

function localDayOf(instant: Date, timeZone: string): DayKey {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * Which resource takes a slot. Deterministic on purpose — `round_robin` ties
 * break on the resource id, so the same state always produces the same answer
 * and the choice is directly testable.
 *
 * There is no `fixed`: "always this person" is expressed by giving the type
 * exactly one resource, and `any` then has one candidate to return.
 */
export function pickResource(
  assignment: "any" | "round_robin",
  resourceIds: string[],
  bookingsPerResource: Map<string, number>,
): string | null {
  const candidates = [...resourceIds].sort();
  if (candidates.length === 0) return null;
  if (assignment !== "round_robin") return candidates[0];

  let best = candidates[0];
  let bestCount = bookingsPerResource.get(best) ?? 0;
  for (const id of candidates.slice(1)) {
    const count = bookingsPerResource.get(id) ?? 0;
    if (count < bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}
