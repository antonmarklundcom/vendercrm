import { describe, expect, it } from "vitest";
import {
  ConversationPushThrottle,
  INBOUND_PUSH_WINDOW_MS,
  recipientsForInbound,
} from "./fanout";

// Who gets buzzed, and how often (PLAN.md §15.5 J2). Both rules are pure, and
// both are the kind that goes wrong quietly: an over-wide fan-out is a team
// turning notifications off, and a throttle that never opens is a phone that
// stops arriving altogether.

describe("recipientsForInbound", () => {
  const team = ["ana", "beto", "carla"];

  it("sends only to the owner when the conversation has one", () => {
    expect(recipientsForInbound("beto", team)).toEqual(["beto"]);
  });

  it("sends to the whole team when nobody owns it", () => {
    // The point of the push on an unassigned conversation: a stranger's first
    // message must not sit unread because it belongs to nobody.
    expect(recipientsForInbound(null, team)).toEqual(team);
    expect(recipientsForInbound(undefined, team)).toEqual(team);
  });

  it("falls back to the team when the owner is no longer active", () => {
    // Deactivated this morning, or moved to another business. Pushing into a
    // queue nobody reads is the same as not pushing at all.
    expect(recipientsForInbound("ex-empleado", team)).toEqual(team);
  });

  it("returns nobody when there is nobody", () => {
    expect(recipientsForInbound(null, [])).toEqual([]);
    expect(recipientsForInbound("ana", [])).toEqual([]);
  });

  it("does not hand back the caller's own array", () => {
    const result = recipientsForInbound(null, team);
    result.push("intruso");
    expect(team).toEqual(["ana", "beto", "carla"]);
  });
});

describe("ConversationPushThrottle", () => {
  const t0 = new Date("2026-09-05T12:00:00Z");
  const at = (ms: number) => new Date(t0.getTime() + ms);

  it("allows the first message and swallows the rest of the burst", () => {
    const throttle = new ConversationPushThrottle();

    // A customer typing four lines in a row is one arrival, not four.
    expect(throttle.claim("conv-1", t0)).toBe(true);
    expect(throttle.claim("conv-1", at(1_000))).toBe(false);
    expect(throttle.claim("conv-1", at(30_000))).toBe(false);
    expect(throttle.claim("conv-1", at(INBOUND_PUSH_WINDOW_MS - 1))).toBe(false);
  });

  it("opens again once the window has passed", () => {
    const throttle = new ConversationPushThrottle();
    throttle.claim("conv-1", t0);

    expect(throttle.claim("conv-1", at(INBOUND_PUSH_WINDOW_MS))).toBe(true);
    // And the window restarts from the push that was actually sent.
    expect(throttle.claim("conv-1", at(INBOUND_PUSH_WINDOW_MS + 1))).toBe(false);
  });

  it("throttles per conversation, not across the tenant", () => {
    const throttle = new ConversationPushThrottle();
    expect(throttle.claim("conv-1", t0)).toBe(true);
    // Two customers writing at once is two arrivals.
    expect(throttle.claim("conv-2", t0)).toBe(true);
    expect(throttle.claim("conv-1", t0)).toBe(false);
  });

  it("forgets conversations that have gone quiet", () => {
    const throttle = new ConversationPushThrottle();
    throttle.claim("old", t0);
    throttle.claim("fresh", at(INBOUND_PUSH_WINDOW_MS * 2));

    // The Map is the size of "active in the last two minutes", not "every
    // conversation since the last deploy" — this runs on every inbound
    // message in a process expected to stay up for weeks.
    expect(throttle.size).toBe(1);
    expect(throttle.claim("old", at(INBOUND_PUSH_WINDOW_MS * 2))).toBe(true);
  });

  it("honours a window of its own", () => {
    const throttle = new ConversationPushThrottle(10_000);
    expect(throttle.claim("conv-1", t0)).toBe(true);
    expect(throttle.claim("conv-1", at(9_999))).toBe(false);
    expect(throttle.claim("conv-1", at(10_000))).toBe(true);
  });
});
