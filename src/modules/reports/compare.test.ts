import { describe, expect, it } from "vitest";
import { withComparison } from "./compare";

describe("withComparison", () => {
  it("attaches the previous period's value of the same metric by key", () => {
    const current = [{ key: "google", leads: 10 }, { key: "facebook", leads: 4 }];
    const previous = [{ key: "google", leads: 6 }];

    const result = withComparison(current, previous, (row) => row.key, (row) => row.leads);

    expect(result).toEqual([
      { key: "google", leads: 10, previous: 6 },
      { key: "facebook", leads: 4, previous: 0 },
    ]);
  });

  it("is empty-window safe", () => {
    expect(withComparison([], [], (row: { key: string }) => row.key, () => 0)).toEqual([]);
  });
});
