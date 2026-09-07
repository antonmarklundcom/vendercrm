import { describe, expect, it } from "vitest";
import { templateNarrative, verifyNarrative, type BriefingInput } from "./narrative";

const baseInput: BriefingInput = {
  businessName: "Clínica Test",
  currency: "PYG",
  locale: "es",
  metrics: {
    leadsThisWeek: 12,
    leadsLastWeek: 9,
    dealsWonThisWeek: 3,
    dealsWonLastWeek: 2,
    wonValueThisWeek: 5_000_000,
    wonValueLastWeek: 3_000_000,
    responseMedianMinutes: 14,
    staleDeals: 2,
    unrepliedQuotes: 1,
    unansweredConversations: 0,
    leadsWithoutDeal: 4,
  },
};

describe("templateNarrative", () => {
  it("cites the real numbers and passes its own verification", () => {
    const generation = templateNarrative(baseInput);
    expect(generation.summary).toContain("12 leads");
    expect(generation.summary).toContain("3 negocios");
    expect(generation.recommendations).toHaveLength(3);
    expect(
      verifyNarrative({ ...generation, citedMetrics: ["leadsThisWeek", "dealsWonThisWeek"] }, baseInput),
    ).toBe(true);
  });

  it("says nothing stale/unreplied/unanswered when the counts are zero", () => {
    const generation = templateNarrative({
      ...baseInput,
      metrics: { ...baseInput.metrics, staleDeals: 0, unrepliedQuotes: 0, unansweredConversations: 0 },
    });
    expect(generation.recommendations[0]).toMatch(/Ningún negocio estancado/);
    expect(generation.recommendations[1]).toMatch(/No hay presupuestos/);
    expect(generation.recommendations[2]).toMatch(/al día/);
  });
});

describe("verifyNarrative", () => {
  it("accepts a citedMetrics key that exists and numbers drawn from the metric set", () => {
    const generation = {
      summary: "Recibiste 12 leads y ganaste 3 negocios por 5.000.000.",
      recommendations: ["Seguí así.", "Revisá tus 2 negocios estancados.", "Todo al día."],
      citedMetrics: ["leadsThisWeek", "dealsWonThisWeek", "wonValueThisWeek", "staleDeals"],
    };
    expect(verifyNarrative(generation, baseInput)).toBe(true);
  });

  it("rejects a citedMetrics key the input doesn't have", () => {
    const generation = {
      summary: "Todo bien.",
      recommendations: ["Uno.", "Dos.", "Tres."],
      citedMetrics: ["totallyMadeUp"],
    };
    expect(verifyNarrative(generation, baseInput)).toBe(false);
  });

  it("rejects an invented number not present in the metric set", () => {
    const generation = {
      summary: "Esta semana recibiste 47 leads, un récord histórico.",
      recommendations: ["Uno.", "Dos.", "Tres."],
      citedMetrics: [],
    };
    expect(verifyNarrative(generation, baseInput)).toBe(false);
  });
});
