import { describe, expect, it } from "vitest";
import { VERTICAL_PRESETS, findPreset } from "./verticals";

// Presets are data, not code paths (plan-booking.md §6.1). These guard the
// properties that make that true — a preset that produced an unbookable
// booking type, or two presets sharing a slug, would push the next developer
// straight back toward per-vertical special cases.

describe("vertical presets", () => {
  it("covers the five verticals in the plan plus a neutral fallback", () => {
    expect(VERTICAL_PRESETS.map((preset) => preset.slug)).toEqual([
      "barberia",
      "clinica",
      "taller",
      "gimnasio",
      "profesionales",
      "generico",
    ]);
  });

  it("gives every preset a resource, hours and at least one bookable type", () => {
    // Any of the three missing yields a public page that offers nothing,
    // which is the one outcome the wizard must never produce.
    for (const preset of VERTICAL_PRESETS) {
      expect(preset.resources.length, preset.slug).toBeGreaterThan(0);
      expect(preset.hours.length, preset.slug).toBeGreaterThan(0);
      expect(preset.bookingTypes.length, preset.slug).toBeGreaterThan(0);
    }
  });

  it("keeps slugs unique, within and across presets", () => {
    const slugs = VERTICAL_PRESETS.map((preset) => preset.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const preset of VERTICAL_PRESETS) {
      const typeSlugs = preset.bookingTypes.map((type) => type.slug);
      expect(new Set(typeSlugs).size, preset.slug).toBe(typeSlugs.length);
    }
  });

  it("writes every hour as valid, ordered wall clock", () => {
    for (const preset of VERTICAL_PRESETS) {
      for (const rule of preset.hours) {
        expect(rule.start, preset.slug).toMatch(/^\d{2}:\d{2}$/);
        expect(rule.end, preset.slug).toMatch(/^\d{2}:\d{2}$/);
        expect(rule.end > rule.start, `${preset.slug} ${rule.start}-${rule.end}`).toBe(true);
        expect(rule.weekday).toBeGreaterThanOrEqual(0);
        expect(rule.weekday).toBeLessThanOrEqual(6);
      }
    }
  });

  it("closes for siesta where the vertical would, and not where it wouldn't", () => {
    // Several rows per weekday is how a midday break is expressed rather
    // than a special case — and a preset that modelled the day as one
    // interval would offer 13:00 to a clínica's patients.
    const clinica = findPreset("clinica")!;
    const monday = clinica.hours.filter((rule) => rule.weekday === 1);
    expect(monday).toHaveLength(2);
    expect(monday[0].end < monday[1].start).toBe(true);

    // A gym's two blocks are morning and evening, not a siesta — the shape
    // is the same, the reason is different, and both must be expressible.
    const gimnasio = findPreset("gimnasio")!;
    expect(gimnasio.hours.filter((rule) => rule.weekday === 1)).toHaveLength(2);
  });

  it("uses capacity only where a group actually fits", () => {
    const gimnasio = findPreset("gimnasio")!;
    for (const type of gimnasio.bookingTypes) {
      expect(type.capacity, type.slug).toBeGreaterThan(1);
    }
    // A barber's chair takes one person, and a preset that shipped capacity 2
    // there would double-book somebody's haircut.
    for (const type of findPreset("barberia")!.bookingTypes) {
      expect(type.capacity ?? 1, type.slug).toBe(1);
    }
  });

  it("never invents a price", () => {
    // A preset guessing what a corte costs in guaraníes would be wrong for
    // every tenant that applied it.
    for (const preset of VERTICAL_PRESETS) {
      for (const type of preset.bookingTypes) {
        for (const service of type.services ?? []) {
          expect(service.extraPrice, `${preset.slug}/${service.name}`).toBeNull();
        }
      }
    }
  });

  it("only offers add-ons on types that allow them", () => {
    for (const preset of VERTICAL_PRESETS) {
      for (const type of preset.bookingTypes) {
        if ((type.services ?? []).length > 0) {
          expect(type.allowMultiService, `${preset.slug}/${type.slug}`).toBe(true);
        }
      }
    }
  });

  it("returns null for a slug nobody defined", () => {
    expect(findPreset("panaderia")).toBeNull();
    expect(findPreset(null)).toBeNull();
    expect(findPreset("")).toBeNull();
  });
});
