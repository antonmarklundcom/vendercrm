import { describe, expect, it } from "vitest";
import { SETUP_PLAN_SCHEMA } from "./schema";

// The setup plan's output schema (PLAN.md §16.5 step 3), tested directly
// rather than only through the mocked-driver integration test —
// `./schema.ts` is import-free of anything DB- or env-touching, same as
// `./conversation.ts` and K1's checklist.ts/narrative.ts precedent.

describe("SETUP_PLAN_SCHEMA", () => {
  const valid = {
    stages: [
      { name: "Consulta" },
      { name: "Presupuesto" },
      { name: "En curso" },
      { name: "Ganado", isWon: true, staleAfterDays: 10 },
      { name: "Perdido", isLost: true },
    ],
    tags: ["nuevo"],
    quickReplies: [
      { name: "Saludo", body: "Hola" },
      { name: "Horario", body: "Abrimos de 8 a 18" },
      { name: "Precio", body: "Te paso el precio" },
    ],
    bookingTypes: [],
    welcomeMessage: "Gracias por escribirnos",
    reviewRequestMessage: null,
    closestVerticalSlug: "generico",
  };

  it("accepts a well-formed plan", () => {
    expect(SETUP_PLAN_SCHEMA.safeParse(valid).success).toBe(true);
  });

  it("rejects a plan with no won stage", () => {
    const noWon = { ...valid, stages: valid.stages.filter((s) => !s.isWon) };
    expect(SETUP_PLAN_SCHEMA.safeParse(noWon).success).toBe(false);
  });

  it("rejects a plan with two lost stages", () => {
    const twoLost = {
      ...valid,
      stages: [...valid.stages, { name: "Descartado", isLost: true }],
    };
    expect(SETUP_PLAN_SCHEMA.safeParse(twoLost).success).toBe(false);
  });

  it("rejects fewer than 3 quick replies", () => {
    const tooFew = { ...valid, quickReplies: valid.quickReplies.slice(0, 2) };
    expect(SETUP_PLAN_SCHEMA.safeParse(tooFew).success).toBe(false);
  });

  it("rejects a closestVerticalSlug outside the catalogue", () => {
    const invalid = { ...valid, closestVerticalSlug: "panaderia" };
    expect(SETUP_PLAN_SCHEMA.safeParse(invalid).success).toBe(false);
  });

  it("rejects fewer than 5 stages", () => {
    const tooFew = { ...valid, stages: valid.stages.slice(0, 4) };
    expect(SETUP_PLAN_SCHEMA.safeParse(tooFew).success).toBe(false);
  });
});
