import { describe, expect, it } from "vitest";
import { decodeSlotChoice, encodeSlotChoice } from "./slot-choice";
import { buildSystemPrompt, extractBookingIntent } from "@/lib/ai/prompt";

// Booking from inside the conversation (plan-booking.md §5.3).
//
// The row id is the whole protocol: it leaves as a list row, comes back
// through Meta's webhook untouched, and has to be enough to make a booking
// with no server-side state in between. So it gets round-trip tests, and
// tests for every shape of *other people's* button ids the webhook will also
// see.

describe("slot choice ids", () => {
  const typeId = "01JBOOKINGTYPE00000000000";
  const startsAt = new Date("2026-09-07T12:00:00.000Z");

  it("round-trips a booking type and a start", () => {
    const decoded = decodeSlotChoice(encodeSlotChoice(typeId, startsAt));
    expect(decoded).toEqual({ bookingTypeId: typeId, startsAt });
  });

  it("stays inside Meta's 200-character limit for a row id", () => {
    expect(encodeSlotChoice(typeId, startsAt).length).toBeLessThanOrEqual(200);
  });

  it("loses no precision on a start that is not on a minute boundary", () => {
    // Slots are minute-aligned in practice, but the id stores seconds, and a
    // silent rounding here would book somebody the wrong time.
    const odd = new Date("2026-09-07T12:34:56.000Z");
    expect(decodeSlotChoice(encodeSlotChoice(typeId, odd))!.startsAt).toEqual(odd);
  });

  it("ignores every reply that is not one of ours", () => {
    // The webhook sees every interactive reply the tenant's number receives,
    // including buttons from flows this module knows nothing about. Anything
    // it does not recognise must be a no-op, never a guess.
    for (const id of [
      null,
      undefined,
      "",
      "yes",
      "bk",
      "bk:only-two",
      "bk:type:notanumber",
      "bk:type:0",
      "bk:type:-100",
      "other:type:1789",
      "bk:type:1789:extra",
    ]) {
      expect(decodeSlotChoice(id)).toBeNull();
    }
  });
});

describe("the AI's booking marker", () => {
  it("is absent from the prompt for a tenant that has not opted in", () => {
    const prompt = buildSystemPrompt({ businessName: "Barbería Central" });
    expect(prompt).not.toContain("[[SLOTS:");
  });

  it("lists the bookable services when the tenant has", () => {
    const prompt = buildSystemPrompt({
      businessName: "Barbería Central",
      bookableTypes: [
        { slug: "corte", name: "Corte de pelo" },
        { slug: "barba", name: "Barba" },
      ],
    });
    expect(prompt).toContain("[[SLOTS:slug]]");
    expect(prompt).toContain("corte — Corte de pelo");
    expect(prompt).toContain("barba — Barba");
  });

  it("tells the model not to name a time or confirm a booking itself", () => {
    // The structural guarantee is that the model cannot write to the
    // database — but a model that says "te agendo el jueves a las 3" has
    // still made a promise nobody kept.
    const prompt = buildSystemPrompt({
      businessName: "X",
      bookableTypes: [{ slug: "corte", name: "Corte" }],
    });
    expect(prompt).toContain("Nunca digas vos un horario concreto");
  });

  it("strips the marker out of what the customer sees", () => {
    const intent = extractBookingIntent(
      "Claro, te muestro los horarios que tenemos. [[SLOTS:corte]]",
    );
    expect(intent.bookingTypeSlug).toBe("corte");
    expect(intent.text).toBe("Claro, te muestro los horarios que tenemos.");
    expect(intent.text).not.toContain("[[");
  });

  it("strips a marker naming a service that does not exist", () => {
    // The slug is looked up and dropped if unknown — but the customer must
    // not see the marker either way.
    const intent = extractBookingIntent("Mirá estos horarios [[SLOTS:inventado]] y avisame.");
    expect(intent.text).toBe("Mirá estos horarios y avisame.");
    expect(intent.bookingTypeSlug).toBe("inventado");
  });

  it("leaves an ordinary reply exactly as written", () => {
    const reply = "Hola, sí, estamos abiertos hasta las 18.";
    expect(extractBookingIntent(reply)).toEqual({ text: reply, bookingTypeSlug: null });
  });

  it("does not fire on text that merely looks like the marker", () => {
    for (const text of ["[[SLOTS]]", "[[SLOT:corte]]", "SLOTS:corte", "[[SLOTS:]]"]) {
      expect(extractBookingIntent(text).bookingTypeSlug).toBeNull();
    }
  });
});
