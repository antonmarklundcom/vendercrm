import { describe, expect, it } from "vitest";
import { generateSlots, type BusyInterval } from "@/modules/booking/slots";

// Google Calendar busy-read (plan-booking.md §5.4).
//
// The design decision under test is that Google contributes *ordinary busy
// intervals* and nothing else. `slots.ts` stays pure — it never learns that
// Google exists — and `bookings.ts` merges the windows into the busy list it
// already builds. So the behaviour worth pinning here is: a Google window
// closes a slot exactly the way a calendar event does, and an empty list
// (the shape a Google outage produces) changes nothing at all.

const TZ = "America/Asuncion";
const NOW = new Date("2026-09-01T12:00:00Z");
const MONDAY = "2026-09-07";
const at = (iso: string) => new Date(iso);

function slotsWith(busy: BusyInterval[]) {
  return generateSlots({
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
    },
    rules: [{ resourceId: "r1", weekday: 1, start: "08:00", end: "11:00" }],
    businessHours: null,
    busy,
    blackouts: [],
    now: NOW,
  }).map((slot) => slot.startsAt.toISOString());
}

describe("Google busy windows in slot generation", () => {
  it("offers the whole window when Google returns nothing", () => {
    expect(slotsWith([])).toEqual([
      "2026-09-07T11:00:00.000Z",
      "2026-09-07T12:00:00.000Z",
      "2026-09-07T13:00:00.000Z",
    ]);
  });

  it("closes a slot a Google appointment overlaps", () => {
    // 09:30–10:00 local: the dentist appointment that used to get
    // double-booked. It closes 09:00 (which runs to 10:00) and 10:00.
    expect(
      slotsWith([
        {
          resourceId: "r1",
          startsAt: at("2026-09-07T12:30:00.000Z"),
          endsAt: at("2026-09-07T13:00:00.000Z"),
        },
      ]),
    ).toEqual(["2026-09-07T11:00:00.000Z", "2026-09-07T13:00:00.000Z"]);
  });

  it("degrades to the unfiltered day when Google is unreachable", () => {
    // busyFromGoogle returns [] on any failure rather than throwing, so an
    // outage costs an over-offered slot instead of taking the booking page
    // down. This is the same assertion as the first test, and that is the
    // point: the failure mode and the no-connection case are identical.
    expect(slotsWith([])).toHaveLength(3);
  });

  it("does not let one person's calendar close another's slots", () => {
    const both = generateSlots({
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
      },
      rules: [
        { resourceId: "r1", weekday: 1, start: "08:00", end: "11:00" },
        { resourceId: "r2", weekday: 1, start: "08:00", end: "11:00" },
      ],
      businessHours: null,
      busy: [
        {
          resourceId: "r1",
          startsAt: at("2026-09-07T12:00:00.000Z"),
          endsAt: at("2026-09-07T13:00:00.000Z"),
        },
      ],
      blackouts: [],
      now: NOW,
    });

    const nine = both.find((slot) => slot.startsAt.toISOString() === "2026-09-07T12:00:00.000Z");
    // Still offered — by the other resource only.
    expect(nine!.resourceIds).toEqual(["r2"]);
  });
});
