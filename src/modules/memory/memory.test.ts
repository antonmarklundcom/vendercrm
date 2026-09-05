import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/ai/prompt";
import type { BusinessFact } from "./facts";
import { completedPct, memoryChecklist, profileFromLegacyAiSettings } from "./checklist";
import {
  estimateTokens,
  formatBusinessHours,
  formatGs,
  renderFact,
  renderMemoryBlock,
  type RenderableProfile,
} from "./render";
import { isPromoActive, packMemory } from "./pack";

// The pure half of the memory (PLAN.md §16). Rendering, budgeting, the
// checklist and the legacy-settings copy are all decisions rather than
// queries, so they are tested here without a database; the retrieval query
// itself is in memory.integration.test.ts.

function fact(overrides: Partial<BusinessFact> & Pick<BusinessFact, "id" | "kind" | "title">) {
  return {
    tenantId: "t",
    body: null,
    structured: null,
    tags: null,
    visibility: "customer",
    source: "manual",
    confirmedAt: new Date("2026-01-01"),
    confirmedByUserId: null,
    reviewAfter: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  } as BusinessFact;
}

const profile: RenderableProfile = {
  displayName: "Clínica Sonrisa",
  about: "Odontología general y estética",
  audience: null,
  differentiators: null,
  tone: "cercano",
  toneNote: null,
  address: "Av. España 123",
  mapsUrl: null,
  website: null,
  paymentMethods: ["efectivo", "transferencia"],
  neverPromise: "plazos de laboratorio",
};

const service = fact({
  id: "f-service",
  kind: "service",
  title: "Limpieza dental",
  body: "Incluye pulido",
  structured: { price: 250000, durationMinutes: 40 },
});

const internalNote = fact({
  id: "f-internal",
  kind: "note",
  title: "Costo real de la limpieza",
  body: "Nos cuesta 90.000 Gs; no bajar de 200.000",
  visibility: "internal",
});

describe("renderMemoryBlock", () => {
  it("puts the profile, hours and the picked facts into one Spanish block", () => {
    const block = renderMemoryBlock({
      audience: "customer",
      profile,
      businessName: "Clínica Sonrisa SRL",
      hours: "Lun a Vie 08:00–17:00",
      always: [
        fact({
          id: "f-policy",
          kind: "policy",
          title: "Cancelación",
          body: "Avisá con 24 horas",
          structured: { topic: "cancellation" },
        }),
      ],
      matched: [service],
      promos: [],
      internal: [],
      truncated: false,
    });

    expect(block).toContain("Negocio: Clínica Sonrisa");
    expect(block).toContain("Horario: Lun a Vie 08:00–17:00");
    expect(block).toContain("Formas de pago: efectivo, transferencia");
    expect(block).toContain("[Cancelación] Cancelación — Avisá con 24 horas");
    expect(block).toContain("Limpieza dental — 250.000 Gs — 40 min");
  });

  it("never renders an internal note for a customer, even if one is handed in", () => {
    // The query is the real defence (§16.2 rule 5); this is the second one,
    // so a caller that passes the wrong list still cannot leak.
    const block = renderMemoryBlock({
      audience: "customer",
      profile,
      businessName: "Clínica",
      hours: null,
      always: [],
      matched: [],
      promos: [],
      internal: [internalNote],
      truncated: false,
    });
    expect(block).not.toContain("Costo real");
  });

  it("shows internal notes to the setup assistant, clearly marked", () => {
    const block = renderMemoryBlock({
      audience: "internal",
      profile,
      businessName: "Clínica",
      hours: null,
      always: [],
      matched: [],
      promos: [],
      internal: [internalNote],
      truncated: false,
    });
    expect(block).toContain("Notas internas");
    expect(block).toContain("Costo real de la limpieza");
  });
});

describe("renderFact", () => {
  it("writes a starting price as 'desde' and a promo with its end date", () => {
    expect(
      renderFact(
        fact({
          id: "s",
          kind: "service",
          title: "Ortodoncia",
          structured: { price: 1500000, priceFrom: true },
        }),
      ),
    ).toBe("Ortodoncia — desde 1.500.000 Gs");

    expect(
      renderFact(
        fact({
          id: "p",
          kind: "promo",
          title: "2x1 en limpieza",
          structured: { validUntil: "2026-09-30" },
        }),
      ),
    ).toBe("2x1 en limpieza — hasta 2026-09-30");
  });
});

describe("formatGs", () => {
  it("groups thousands with dots, the way a guaraní price is written", () => {
    expect(formatGs(250000)).toBe("250.000 Gs");
    expect(formatGs(1500)).toBe("1.500 Gs");
    expect(formatGs(0)).toBe("0 Gs");
  });
});

describe("formatBusinessHours", () => {
  it("collapses consecutive days that share a range", () => {
    expect(
      formatBusinessHours({
        mon: { start: "08:00", end: "17:00" },
        tue: { start: "08:00", end: "17:00" },
        wed: { start: "08:00", end: "17:00" },
        thu: { start: "08:00", end: "17:00" },
        fri: { start: "08:00", end: "17:00" },
        sat: { start: "08:00", end: "12:00" },
        sun: null,
      }),
    ).toBe("Lun a Vie 08:00–17:00, Sáb 08:00–12:00");
  });

  it("is null when nothing is configured", () => {
    expect(formatBusinessHours(null)).toBeNull();
    expect(formatBusinessHours({ mon: null, sun: null })).toBeNull();
  });
});

describe("packMemory", () => {
  const always = [
    fact({ id: "a1", kind: "policy", title: "Seña", body: "50%", structured: { topic: "deposit" } }),
  ];
  const candidates = Array.from({ length: 20 }, (_, i) =>
    fact({
      id: `c${i}`,
      kind: "faq",
      title: `Pregunta número ${i}`,
      body: "Una respuesta razonablemente larga para gastar presupuesto de tokens.",
    }),
  );

  it("keeps the profile and the always-facts, and cuts the retrieved ones to fit", () => {
    const packed = packMemory({
      audience: "customer",
      profile,
      businessName: "Clínica",
      hours: "Lun a Vie 08:00–17:00",
      always,
      candidates,
      promos: [],
      internal: [],
      budgetTokens: 120,
    });

    expect(packed.always).toHaveLength(1);
    expect(packed.truncated).toBe(true);
    expect(packed.matched.length).toBeGreaterThan(0);
    expect(packed.matched.length).toBeLessThan(candidates.length);
    expect(estimateTokens(renderMemoryBlock(packed))).toBeLessThanOrEqual(140);
  });

  it("takes the retrieved facts best-first, so the budget buys the most relevant ones", () => {
    const packed = packMemory({
      audience: "customer",
      profile,
      businessName: "Clínica",
      hours: null,
      always: [],
      candidates,
      promos: [],
      internal: [],
      budgetTokens: 100,
    });
    expect(packed.matched[0]?.id).toBe("c0");
  });

  it("fits everything when the budget is generous, and says so", () => {
    const packed = packMemory({
      audience: "customer",
      profile,
      businessName: "Clínica",
      hours: null,
      always,
      candidates: [service],
      promos: [],
      internal: [],
      budgetTokens: 5000,
    });
    expect(packed.truncated).toBe(false);
    expect(packed.matched).toHaveLength(1);
  });
});

describe("isPromoActive", () => {
  const promo = (structured: Record<string, unknown>) =>
    fact({ id: "p", kind: "promo", title: "Promo", structured });

  it("is true inside the dates and false outside them", () => {
    const now = new Date("2026-09-15T12:00:00Z");
    expect(isPromoActive(promo({ validFrom: "2026-09-01", validUntil: "2026-09-30" }), now)).toBe(
      true,
    );
    expect(isPromoActive(promo({ validUntil: "2026-09-14" }), now)).toBe(false);
    expect(isPromoActive(promo({ validFrom: "2026-10-01" }), now)).toBe(false);
    // No dates at all means "always on", which is what an undated offer is.
    expect(isPromoActive(promo({}), now)).toBe(true);
  });

  it("uses the tenant's today, not UTC's", () => {
    // 01:30 UTC on the 1st is still 21:30 on the 30th in Asunción, and the
    // promo the business wrote "hasta el 30" is still running that evening.
    const lateEvening = new Date("2026-10-01T01:30:00Z");
    expect(isPromoActive(promo({ validUntil: "2026-09-30" }), lateEvening)).toBe(true);
    expect(
      isPromoActive(promo({ validUntil: "2026-09-30" }), lateEvening, "Europe/Stockholm"),
    ).toBe(false);
  });
});

describe("memoryChecklist", () => {
  const facts = [
    fact({ id: "1", kind: "faq", title: "¿Atienden urgencias?" }),
    fact({ id: "2", kind: "faq", title: "¿Aceptan seguro?" }),
    fact({ id: "3", kind: "faq", title: "¿Hay estacionamiento?" }),
    fact({
      id: "4",
      kind: "policy",
      title: "Cancelación",
      structured: { topic: "cancellation" },
    }),
  ];

  it("counts a row done only when the thing actually exists", () => {
    const rows = memoryChecklist({ profile: null, facts: [], hasBusinessHours: false });
    expect(rows.every((row) => !row.done)).toBe(true);
    expect(completedPct({ profile: null, facts: [], hasBusinessHours: false })).toBe(0);
  });

  it("is complete once the profile, the hours and the facts are all there", () => {
    const input = {
      profile: { ...profile, about: "Odontología", tone: "cercano" as const },
      facts,
      hasBusinessHours: true,
    };
    expect(completedPct(input)).toBe(100);
  });

  it("does not count an internal FAQ towards the customer-facing target", () => {
    const internalFaqs = facts.map((row) => ({ ...row, visibility: "internal" as const }));
    const rows = memoryChecklist({ profile, facts: internalFaqs, hasBusinessHours: true });
    expect(rows.find((row) => row.key === "faqs")?.done).toBe(false);
  });

  it("counts a free-text 'Horario' fact as hours, without the structured week", () => {
    const rows = memoryChecklist({
      profile,
      facts: [fact({ id: "h", kind: "location", title: "Horario", body: "de 8 a 17" })],
      hasBusinessHours: false,
    });
    expect(rows.find((row) => row.key === "hours")?.done).toBe(true);
  });
});

describe("profileFromLegacyAiSettings", () => {
  // What migration 0028 copies, expressed as code: the same mapping runs in
  // SQL for existing tenants and here for a tenant whose profile row does
  // not exist yet (§16.3 "Migration").
  it("copies the five settings.ai fields, hours becoming a fact body", () => {
    const copied = profileFromLegacyAiSettings({
      businessName: "Climatex",
      about: "Instalación de aire acondicionado",
      tone: "cercano",
      hours: "Lunes a viernes de 8 a 17",
      neverPromise: "plazos de instalación",
    });

    expect(copied).toEqual({
      displayName: "Climatex",
      about: "Instalación de aire acondicionado",
      tone: "cercano",
      toneNote: "cercano",
      neverPromise: "plazos de instalación",
      hoursFactBody: "Lunes a viernes de 8 a 17",
    });
  });

  it("keeps a free-text tone as a note rather than inventing an enum value", () => {
    const copied = profileFromLegacyAiSettings({ tone: "amable pero corto" });
    expect(copied.tone).toBeNull();
    expect(copied.toneNote).toBe("amable pero corto");
  });

  it("maps an empty or absent settings.ai to nulls, not to empty strings", () => {
    expect(profileFromLegacyAiSettings(undefined)).toEqual({
      displayName: null,
      about: null,
      tone: null,
      toneNote: null,
      neverPromise: null,
      hoursFactBody: null,
    });
    expect(profileFromLegacyAiSettings({ about: "   " }).about).toBeNull();
  });
});

describe("buildSystemPrompt with the memory block", () => {
  it("carries the memory and still carries the guardrails", () => {
    const block = renderMemoryBlock({
      audience: "customer",
      profile,
      businessName: "Clínica",
      hours: null,
      always: [],
      matched: [service],
      promos: [],
      internal: [],
      truncated: false,
    });
    const prompt = buildSystemPrompt({ businessName: "Clínica Sonrisa", memory: block });

    expect(prompt).toContain("Limpieza dental — 250.000 Gs");
    expect(prompt).toContain("Nunca inventes precios");
  });
});
