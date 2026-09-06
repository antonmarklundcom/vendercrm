import { describe, expect, it } from "vitest";
import { daysInStage, isStale } from "./stale";

const DAY = 24 * 60 * 60 * 1000;

describe("daysInStage", () => {
  it("floors partial days", () => {
    const enteredAt = new Date(Date.now() - 2.9 * DAY);
    expect(daysInStage(enteredAt)).toBe(2);
  });

  it("never goes negative for a future timestamp", () => {
    expect(daysInStage(new Date(Date.now() + DAY))).toBe(0);
  });
});

describe("isStale", () => {
  it("is never stale when the stage has no threshold", () => {
    expect(isStale(new Date(Date.now() - 999 * DAY), null)).toBe(false);
  });

  it("is not stale exactly at the threshold — the boundary", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    const enteredAt = new Date("2026-01-05T00:00:00Z"); // exactly 5 days
    expect(isStale(enteredAt, 5, now)).toBe(false);
  });

  it("is stale one day past the threshold", () => {
    const now = new Date("2026-01-11T00:00:00Z");
    const enteredAt = new Date("2026-01-05T00:00:00Z"); // 6 days
    expect(isStale(enteredAt, 5, now)).toBe(true);
  });
});
