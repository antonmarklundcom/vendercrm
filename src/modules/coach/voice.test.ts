import { describe, expect, it } from "vitest";
import { matchesCoachIntent } from "./voice";

// The coach half of §15.3's Lane A answers a *short list* of ways of asking
// one question and nothing else — a voice note about anything else must
// stay a customer message (PLAN.md §15.10 W1).

describe("matchesCoachIntent", () => {
  it("matches the ways an owner asks what is pending", () => {
    for (const said of [
      "hola, qué tengo hoy?",
      "QUE HAY HOY",
      "decime los pendientes",
      "mis tareas",
      "cómo está la agenda",
    ]) {
      expect(matchesCoachIntent(said)).toBe(true);
    }
  });

  it("stays out of the way of everything else", () => {
    for (const said of [
      "pasame el presupuesto del portón",
      "llegamos en veinte minutos",
      "",
      "   ",
    ]) {
      expect(matchesCoachIntent(said)).toBe(false);
    }
  });
});
