import { describe, expect, it } from "vitest";
import { PUSH_KINDS, applyPushPrefs, isKindMuted, parsePushPrefs } from "./prefs";

// Per-user push mutes (PLAN.md §15.5 J2). The whole point of the storage shape
// is that silence is never the default: a column nobody has written, a column
// written before a kind existed, and a column somebody hand-edited into
// nonsense must all mean "this person hears about their work".

describe("parsePushPrefs", () => {
  it("treats null, undefined and {} as no preference", () => {
    expect(parsePushPrefs(null)).toEqual({});
    expect(parsePushPrefs(undefined)).toEqual({});
    expect(parsePushPrefs({})).toEqual({});
  });

  it("falls back to no preference rather than throwing on a bad value", () => {
    // A hand-edited row, or a shape an older version of this code wrote.
    // Refusing to parse must not stop the push.
    expect(parsePushPrefs("nope")).toEqual({});
    expect(parsePushPrefs(42)).toEqual({});
    expect(parsePushPrefs({ inbound_message: "off" })).toEqual({});
    expect(parsePushPrefs({ unknown_kind: false })).toEqual({});
  });

  it("keeps the mutes it recognises", () => {
    expect(parsePushPrefs({ inbound_message: false })).toEqual({ inbound_message: false });
  });
});

describe("isKindMuted", () => {
  it("is false for everything until something is switched off", () => {
    for (const kind of PUSH_KINDS) {
      expect(isKindMuted(null, kind)).toBe(false);
      expect(isKindMuted({}, kind)).toBe(false);
    }
  });

  it("mutes only the kind that was switched off", () => {
    const prefs = { inbound_message: false };
    expect(isKindMuted(prefs, "inbound_message")).toBe(true);
    expect(isKindMuted(prefs, "assignment")).toBe(false);
    expect(isKindMuted(prefs, "task_due")).toBe(false);
  });

  it("never mutes `system`", () => {
    // What the platform says when something needs a person. There is no
    // version of this product where that arrives silently — and a stored
    // `system: false` from a tampered payload must not change that.
    expect(isKindMuted({ system: false }, "system")).toBe(false);
  });
});

describe("applyPushPrefs", () => {
  it("stores only what was switched off", () => {
    const next = applyPushPrefs(null, {
      inbound_message: false,
      assignment: true,
      task_due: true,
      automation: true,
    });
    // Not a snapshot of every kind that existed the day settings was last
    // opened: a kind added by a later phase is on for everyone, no backfill.
    expect(next).toEqual({ inbound_message: false });
  });

  it("switches a kind back on by removing it", () => {
    expect(applyPushPrefs({ inbound_message: false }, { inbound_message: true })).toEqual({});
  });

  it("leaves kinds the form did not mention alone", () => {
    expect(applyPushPrefs({ task_due: false }, { inbound_message: false })).toEqual({
      task_due: false,
      inbound_message: false,
    });
  });

  it("ignores keys that are not a mutable kind", () => {
    expect(applyPushPrefs(null, { system: false, nonsense: false })).toEqual({});
  });

  it("does not mutate the value it was given", () => {
    const current = { task_due: false };
    applyPushPrefs(current, { task_due: true });
    expect(current).toEqual({ task_due: false });
  });
});
