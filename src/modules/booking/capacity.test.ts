import { describe, expect, it } from "vitest";
import { generateSlots, type GenerateSlotsInput } from "./slots";
import { extraDurationOf, extraPriceOf, type BookedService } from "./service-totals";

// Capacity is the one change in this build that touches the double-booking
// logic, so it gets boundary tests at N-1, N and N+1 rather than a happy path
// (plan-booking.md §5.2).
//
// The rule being pinned: capacity is per *exact start of this type*. A class
// with places left keeps being offered; a booking that merely overlaps is
// still a hard block, because two classes cannot half-share a room however
// many seats each has.

const TZ = "America/Asuncion";
const NOW = new Date("2026-09-01T12:00:00Z");
// A Monday. Asunción is UTC-3 here, so 08:00 local is 11:00Z.
const MONDAY = "2026-09-07";
const at = (iso: string) => new Date(iso);

function input(over: Partial<GenerateSlotsInput> = {}): GenerateSlotsInput {
  return {
    timeZone: TZ,
    from: MONDAY,
    to: MONDAY,
    type: {
      durationMinutes: 60,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      slotIncrementMinutes: 60,
      minNoticeMinutes: 0,
      maxAdvanceDays: 365,
      capacity: 1,
    },
    rules: [{ resourceId: "r1", weekday: 1, start: "08:00", end: "11:00" }],
    businessHours: null,
    busy: [],
    blackouts: [],
    now: NOW,
    ...over,
  };
}

const NINE = at("2026-09-07T12:00:00.000Z"); // 09:00 local

describe("capacity", () => {
  it("keeps offering a start until the places run out", () => {
    const slots = generateSlots(
      input({
        type: { ...input().type, capacity: 3 },
        seatsTaken: [{ resourceId: "r1", startsAt: NINE, seats: 2 }],
      }),
    );
    const nine = slots.find((slot) => slot.startsAt.getTime() === NINE.getTime());
    expect(nine).toBeDefined();
    expect(nine!.seatsRemaining).toBe(1);
  });

  it("drops the start once the last place goes", () => {
    const slots = generateSlots(
      input({
        type: { ...input().type, capacity: 3 },
        seatsTaken: [{ resourceId: "r1", startsAt: NINE, seats: 3 }],
      }),
    );
    expect(slots.some((slot) => slot.startsAt.getTime() === NINE.getTime())).toBe(false);
  });

  it("does not go negative, or come back, when a row oversubscribes a start", () => {
    // Defensive: a party of four written against a class of three (a capacity
    // lowered after the fact) must close the slot, not wrap around.
    const slots = generateSlots(
      input({
        type: { ...input().type, capacity: 3 },
        seatsTaken: [{ resourceId: "r1", startsAt: NINE, seats: 4 }],
      }),
    );
    expect(slots.some((slot) => slot.startsAt.getTime() === NINE.getTime())).toBe(false);
  });

  it("counts a party against the places, not the row", () => {
    // One reservation for four takes four of the twelve places.
    const slots = generateSlots(
      input({
        type: { ...input().type, capacity: 12 },
        seatsTaken: [
          { resourceId: "r1", startsAt: NINE, seats: 4 },
          { resourceId: "r1", startsAt: NINE, seats: 5 },
        ],
      }),
    );
    const nine = slots.find((slot) => slot.startsAt.getTime() === NINE.getTime());
    expect(nine!.seatsRemaining).toBe(3);
  });

  it("behaves exactly as before when capacity is 1", () => {
    // The regression that matters most: one seat taken at a start closes it,
    // which is what "somebody already booked this" meant before capacity
    // existed.
    const withSeat = generateSlots(
      input({ seatsTaken: [{ resourceId: "r1", startsAt: NINE, seats: 1 }] }),
    );
    expect(withSeat.some((slot) => slot.startsAt.getTime() === NINE.getTime())).toBe(false);
    // And an untouched generator offers every start with one place each.
    for (const slot of generateSlots(input())) expect(slot.seatsRemaining).toBe(1);
  });

  it("keeps an overlapping booking a hard block, capacity or not", () => {
    // 09:30–10:30 is not this start, so it is busy — it must close both the
    // 09:00 and the 10:00 slot even in a class of twelve.
    const slots = generateSlots(
      input({
        type: { ...input().type, capacity: 12 },
        busy: [
          {
            resourceId: "r1",
            startsAt: at("2026-09-07T12:30:00.000Z"),
            endsAt: at("2026-09-07T13:30:00.000Z"),
          },
        ],
      }),
    );
    expect(slots.map((slot) => slot.startsAt.toISOString())).toEqual([
      "2026-09-07T11:00:00.000Z",
    ]);
  });

  it("reports the roomiest resource when several serve the same start", () => {
    const slots = generateSlots(
      input({
        type: { ...input().type, capacity: 5 },
        rules: [
          { resourceId: "r1", weekday: 1, start: "08:00", end: "11:00" },
          { resourceId: "r2", weekday: 1, start: "08:00", end: "11:00" },
        ],
        seatsTaken: [{ resourceId: "r1", startsAt: NINE, seats: 4 }],
      }),
    );
    const nine = slots.find((slot) => slot.startsAt.getTime() === NINE.getTime())!;
    // r1 has one left, r2 has five. A visitor can still buy five.
    expect(nine.seatsRemaining).toBe(5);
    expect(nine.resourceIds).toEqual(["r1", "r2"]);
  });

  it("does not let one resource's seats close another resource's start", () => {
    const slots = generateSlots(
      input({
        type: { ...input().type, capacity: 2 },
        rules: [
          { resourceId: "r1", weekday: 1, start: "08:00", end: "11:00" },
          { resourceId: "r2", weekday: 1, start: "08:00", end: "11:00" },
        ],
        seatsTaken: [{ resourceId: "r1", startsAt: NINE, seats: 2 }],
      }),
    );
    const nine = slots.find((slot) => slot.startsAt.getTime() === NINE.getTime())!;
    expect(nine.resourceIds).toEqual(["r2"]);
    expect(nine.seatsRemaining).toBe(2);
  });
});

describe("multi-service duration", () => {
  const services: BookedService[] = [
    { id: "s1", name: "Barba", extraDurationMinutes: 15, extraPrice: 20000 },
    { id: "s2", name: "Lavado", extraDurationMinutes: 10, extraPrice: 10000 },
  ];

  it("adds up minutes and money", () => {
    expect(extraDurationOf(services)).toBe(25);
    expect(extraPriceOf(services)).toBe(30000);
    expect(extraDurationOf([])).toBe(0);
    expect(extraPriceOf([])).toBe(0);
  });

  it("treats a priceless add-on as free, not as NaN", () => {
    expect(extraPriceOf([{ id: "s3", name: "Consulta", extraDurationMinutes: 0, extraPrice: null }]))
      .toBe(0);
  });

  it("closes the last start of the day once the add-ons no longer fit", () => {
    // 08:00–11:00, hourly, 60-minute type: three starts. Tick 15 minutes of
    // add-ons and 10:00 runs to 11:15 — past closing, so it goes.
    const base = generateSlots(input());
    expect(base).toHaveLength(3);

    const withExtra = generateSlots(
      input({ type: { ...input().type, durationMinutes: 75 } }),
    );
    expect(withExtra.map((slot) => slot.startsAt.toISOString())).toEqual([
      "2026-09-07T11:00:00.000Z",
      "2026-09-07T12:00:00.000Z",
    ]);
  });

  it("keeps the offered starts on the type's own grid", () => {
    // The add-ons lengthen the appointment; they must not move 09:00 to
    // 09:15. The increment is the type's, the fit test is the total's.
    const withExtra = generateSlots(input({ type: { ...input().type, durationMinutes: 75 } }));
    for (const slot of withExtra) {
      expect(slot.startsAt.getTime() % (60 * 60_000)).toBe(0);
    }
  });
});
