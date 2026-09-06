import { describe, expect, it } from "vitest";
import {
  computeResponseBuckets,
  computeResponseTimes,
  computeStageFunnel,
  previousWindow,
  reportWindow,
} from "./sales";

// First-response time is the one number here that is a judgement rather than
// a count, so its rules are pinned down: which message starts the clock,
// which stops it, and what happens to a conversation nobody answered.

const at = (iso: string) => new Date(iso);

function message(conversationId: string, direction: "in" | "out", iso: string) {
  return { conversationId, direction, createdAt: at(iso) };
}

describe("computeResponseTimes", () => {
  it("measures from the first inbound to the first reply after it", () => {
    const result = computeResponseTimes([
      message("c1", "in", "2026-08-24T12:00:00Z"),
      message("c1", "out", "2026-08-24T12:30:00Z"),
    ]);

    expect(result.answered).toBe(1);
    expect(result.medianMinutes).toBe(30);
    expect(result.unanswered).toBe(0);
  });

  it("ignores an outbound that came before the customer wrote", () => {
    // A template sent yesterday is not a reply to today's message.
    const result = computeResponseTimes([
      message("c1", "out", "2026-08-24T09:00:00Z"),
      message("c1", "in", "2026-08-24T12:00:00Z"),
      message("c1", "out", "2026-08-24T12:15:00Z"),
    ]);

    expect(result.medianMinutes).toBe(15);
  });

  it("counts an unanswered conversation separately instead of as a huge number", () => {
    // Folding it into the average is how one ignored customer hides behind a
    // decent-looking mean.
    const result = computeResponseTimes([
      message("c1", "in", "2026-08-24T12:00:00Z"),
      message("c2", "in", "2026-08-24T12:00:00Z"),
      message("c2", "out", "2026-08-24T12:10:00Z"),
    ]);

    expect(result.answered).toBe(1);
    expect(result.unanswered).toBe(1);
    expect(result.medianMinutes).toBe(10);
  });

  it("skips a conversation the business started and the customer never answered", () => {
    const result = computeResponseTimes([message("c1", "out", "2026-08-24T12:00:00Z")]);

    expect(result).toEqual({
      answered: 0,
      unanswered: 0,
      medianMinutes: null,
      slowestMinutes: null,
    });
  });

  it("takes the median, not the mean — one bad weekend must not set the number", () => {
    const result = computeResponseTimes([
      message("c1", "in", "2026-08-24T12:00:00Z"),
      message("c1", "out", "2026-08-24T12:05:00Z"),
      message("c2", "in", "2026-08-24T12:00:00Z"),
      message("c2", "out", "2026-08-24T12:10:00Z"),
      message("c3", "in", "2026-08-22T12:00:00Z"),
      message("c3", "out", "2026-08-24T12:00:00Z"),
    ]);

    expect(result.medianMinutes).toBe(10);
    expect(result.slowestMinutes).toBe(2880);
  });

  it("is unordered-input safe", () => {
    const result = computeResponseTimes([
      message("c1", "out", "2026-08-24T12:20:00Z"),
      message("c1", "in", "2026-08-24T12:00:00Z"),
    ]);

    expect(result.medianMinutes).toBe(20);
  });
});

describe("reportWindow", () => {
  it("ends now and starts N days back", () => {
    const now = at("2026-08-24T12:00:00Z");
    const window = reportWindow(30, now);

    expect(window.to).toEqual(now);
    expect(window.from.toISOString()).toBe("2026-07-25T12:00:00.000Z");
    expect(window.days).toBe(30);
  });

  it("straddles a month boundary without losing a day", () => {
    // 2026-08-01 minus 5 days lands in July — the from/to pair must cross
    // the boundary cleanly, not clamp to the 1st.
    const now = at("2026-08-01T00:00:00Z");
    const window = reportWindow(5, now);
    expect(window.from.toISOString()).toBe("2026-07-27T00:00:00.000Z");
  });
});

describe("previousWindow", () => {
  it("is the same length, immediately before the window starts", () => {
    const window = { from: at("2026-08-01T00:00:00Z"), to: at("2026-08-31T00:00:00Z"), days: 30 };
    const previous = previousWindow(window);

    expect(previous.to).toEqual(window.from);
    expect(previous.from.toISOString()).toBe("2026-07-02T00:00:00.000Z");
    expect(previous.days).toBe(30);
  });
});

describe("computeResponseBuckets", () => {
  it("buckets answered conversations and always returns every bucket", () => {
    const buckets = computeResponseBuckets([
      message("fast", "in", "2026-08-24T12:00:00Z"),
      message("fast", "out", "2026-08-24T12:05:00Z"),
      message("medium", "in", "2026-08-24T12:00:00Z"),
      message("medium", "out", "2026-08-24T12:30:00Z"),
      message("slow", "in", "2026-08-24T12:00:00Z"),
      message("slow", "out", "2026-08-25T18:00:00Z"),
      message("unanswered", "in", "2026-08-24T12:00:00Z"),
    ]);

    expect(buckets).toEqual([
      { bucket: "under15m", count: 1 },
      { bucket: "15mTo1h", count: 1 },
      { bucket: "1hTo24h", count: 0 },
      { bucket: "over24h", count: 1 },
    ]);
  });

  it("is empty-window safe", () => {
    expect(computeResponseBuckets([])).toEqual([
      { bucket: "under15m", count: 0 },
      { bucket: "15mTo1h", count: 0 },
      { bucket: "1hTo24h", count: 0 },
      { bucket: "over24h", count: 0 },
    ]);
  });
});

describe("computeStageFunnel", () => {
  const stage = (id: string, pipelineId: string, position: number, name = id) => ({
    id,
    pipelineId,
    position,
    name,
  });
  const deal = (id: string, pipelineId: string, stageId: string) => ({ id, pipelineId, stageId });

  it("is cumulative: a deal further along counts for every earlier stage too", () => {
    const stages = [
      stage("s1", "p1", 0, "Nuevo"),
      stage("s2", "p1", 1, "Contactado"),
      stage("s3", "p1", 2, "Ganado"),
    ];
    const deals = [
      deal("d1", "p1", "s1"),
      deal("d2", "p1", "s2"),
      deal("d3", "p1", "s3"),
    ];

    const funnel = computeStageFunnel(deals as never, stages as never, "p1");

    expect(funnel).toEqual([
      { stageId: "s1", name: "Nuevo", position: 0, reachedOrPast: 3 },
      { stageId: "s2", name: "Contactado", position: 1, reachedOrPast: 2 },
      { stageId: "s3", name: "Ganado", position: 2, reachedOrPast: 1 },
    ]);
  });

  it("ignores deals from a different pipeline", () => {
    const stages = [stage("s1", "p1", 0), stage("s2", "p2", 0)];
    const deals = [deal("d1", "p1", "s1"), deal("d2", "p2", "s2")];

    const funnel = computeStageFunnel(deals as never, stages as never, "p1");
    expect(funnel).toEqual([{ stageId: "s1", name: "s1", position: 0, reachedOrPast: 1 }]);
  });

  it("is empty-window safe", () => {
    expect(computeStageFunnel([], [], "p1")).toEqual([]);
  });
});
