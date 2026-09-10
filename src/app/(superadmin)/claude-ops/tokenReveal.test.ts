import { describe, expect, it, vi } from "vitest";

import {
  canCloseReveal,
  isRevealAcknowledged,
  isRevealOpen,
  shouldWarnBeforeUnload,
  warnBeforeUnload,
  type TokenRevealState,
} from "./tokenReveal";

// The ops token is shown in plaintext exactly once (PLAN.md §18.1 point 1) and
// SHA-256 hashed at rest, so a reveal the owner clicks past is a token that no
// longer exists for anyone. That happened: created through the console,
// rendered in an inline panel, lost on the next page load. These are the rules
// that make the reveal un-loseable — the component reads them, so a regression
// in the reveal's guard rails fails here rather than costing another token.

const NONE: TokenRevealState = { plaintext: null, acknowledgedFor: null, closedFor: null };
const SHOWING: TokenRevealState = {
  plaintext: "vc_ops_abc",
  acknowledgedFor: null,
  closedFor: null,
};
const ACKNOWLEDGED: TokenRevealState = { ...SHOWING, acknowledgedFor: "vc_ops_abc" };
const CLOSED: TokenRevealState = { ...ACKNOWLEDGED, closedFor: "vc_ops_abc" };

describe("ops token reveal", () => {
  it("is closed until a token exists", () => {
    expect(isRevealOpen(NONE)).toBe(false);
    expect(isRevealAcknowledged(NONE)).toBe(false);
  });

  it("opens as soon as a plaintext token arrives", () => {
    expect(isRevealOpen(SHOWING)).toBe(true);
    expect(isRevealAcknowledged(SHOWING)).toBe(false);
  });

  it("cannot be closed before the owner confirms he copied it", () => {
    expect(canCloseReveal(SHOWING)).toBe(false);
    expect(canCloseReveal(ACKNOWLEDGED)).toBe(true);
  });

  it("stays open after acknowledgement until the owner closes it", () => {
    expect(isRevealOpen(ACKNOWLEDGED)).toBe(true);
    expect(isRevealOpen(CLOSED)).toBe(false);
  });

  it("starts over for a second token — acknowledgement does not carry", () => {
    // The owner copied token A, closed the dialog, then created token B. Both
    // flags still name A, so B is an unacknowledged reveal of its own.
    const second: TokenRevealState = { ...CLOSED, plaintext: "vc_ops_xyz" };
    expect(isRevealOpen(second)).toBe(true);
    expect(isRevealAcknowledged(second)).toBe(false);
    expect(canCloseReveal(second)).toBe(false);
  });
});

describe("leaving the page while a token is showing", () => {
  function event() {
    return { preventDefault: vi.fn(), returnValue: undefined as unknown };
  }

  it("warns while an unacknowledged token is on screen", () => {
    expect(shouldWarnBeforeUnload(SHOWING)).toBe(true);

    const unload = event();
    expect(warnBeforeUnload(unload, SHOWING, "gone for good")).toBe(true);
    expect(unload.preventDefault).toHaveBeenCalled();
    // Legacy browsers arm their prompt off a non-empty returnValue; modern
    // ones ignore the text but still need preventDefault.
    expect(unload.returnValue).toBe("gone for good");
  });

  it("stops warning once the owner says he copied it", () => {
    expect(shouldWarnBeforeUnload(ACKNOWLEDGED)).toBe(false);

    const unload = event();
    expect(warnBeforeUnload(unload, ACKNOWLEDGED, "gone for good")).toBe(false);
    expect(unload.preventDefault).not.toHaveBeenCalled();
    expect(unload.returnValue).toBeUndefined();
  });

  it("does not warn when there is no token and none after closing", () => {
    expect(shouldWarnBeforeUnload(NONE)).toBe(false);
    expect(shouldWarnBeforeUnload(CLOSED)).toBe(false);
  });

  it("warns again for a second token created in the same session", () => {
    expect(shouldWarnBeforeUnload({ ...CLOSED, plaintext: "vc_ops_xyz" })).toBe(true);
  });
});
