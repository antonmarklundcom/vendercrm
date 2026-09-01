import { describe, expect, it } from "vitest";
import {
  GRAPH_API_BASE,
  GRAPH_API_VERSION,
  GRAPH_API_VERSION_REVIEW_DATES,
  graphVersionWarning,
} from "./graph";

// The Graph API version is an env value now (PLAN.md §14 I2 #2). What the
// tests pin is the part that protects the operator: a version past its
// review date has to surface *before* Meta retires it, because a retired
// version takes every tenant's WhatsApp down at once.

describe("graph api version", () => {
  it("builds the base URL from the configured version", () => {
    expect(GRAPH_API_BASE).toBe(`https://graph.facebook.com/${GRAPH_API_VERSION}`);
  });

  it("has a documented review date for the version it ships with", () => {
    expect(GRAPH_API_VERSION_REVIEW_DATES[GRAPH_API_VERSION]).toBeTruthy();
  });

  it("stays quiet while the version is inside its window", () => {
    expect(graphVersionWarning(new Date("2026-09-30T23:00:00.000Z"), "v21.0")).toBeNull();
  });

  it("warns from the review date onward", () => {
    expect(graphVersionWarning(new Date("2026-10-01T00:00:00.000Z"), "v21.0")).toEqual({
      kind: "past_review",
      version: "v21.0",
      reviewDate: "2026-10-01",
    });
    expect(graphVersionWarning(new Date("2027-03-01T00:00:00.000Z"), "v21.0")).toMatchObject({
      kind: "past_review",
    });
  });

  it("warns about a version nobody wrote a review date for", () => {
    // Someone bumping the env past what this app knows about is exactly when
    // silence would be worst.
    expect(graphVersionWarning(new Date("2026-01-01T00:00:00.000Z"), "v99.0")).toEqual({
      kind: "undocumented",
      version: "v99.0",
    });
  });
});
