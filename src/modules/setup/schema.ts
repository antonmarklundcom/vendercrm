import { z } from "zod";
import { VERTICAL_PRESETS, findPreset, type VerticalPreset } from "@/modules/tenancy/verticals";

// The setup plan's output schema and the pure preset-building it feeds
// (PLAN.md §16.5 step 3). Kept import-free of anything DB- or env-touching
// (like K1's checklist.ts, narrative.ts) so it is testable directly —
// `plan.ts` is the impure half that calls the driver and reads/writes rows.

const stageSchema = z.object({
  name: z.string().trim().min(1).max(60),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
  staleAfterDays: z.number().int().min(1).max(365).optional(),
});

export const SETUP_PLAN_SCHEMA = z
  .object({
    stages: z.array(stageSchema).min(5).max(7),
    tags: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
    quickReplies: z
      .array(z.object({ name: z.string().trim().min(1).max(60), body: z.string().trim().min(1).max(500) }))
      .min(3)
      .max(5),
    bookingTypes: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(100),
          slug: z
            .string()
            .trim()
            .toLowerCase()
            .regex(/^[a-z0-9-]+$/)
            .max(60),
          durationMinutes: z.number().int().min(5).max(480),
        }),
      )
      .max(4)
      .default([]),
    /** Sent the moment a customer writes outside business hours (§16.5). */
    welcomeMessage: z.string().trim().min(1).max(500).nullable().optional(),
    /** Sent when a deal is dragged to a won stage. */
    reviewRequestMessage: z.string().trim().min(1).max(500).nullable().optional(),
    /** Which catalogue preset this business reads closest to — the model's
     *  own judgment beats a keyword match on the brief. */
    closestVerticalSlug: z.enum(VERTICAL_PRESETS.map((preset) => preset.slug) as [string, ...string[]]),
  })
  .refine((plan) => plan.stages.filter((stage) => stage.isWon).length === 1, {
    message: "exactly one stage must be isWon",
    path: ["stages"],
  })
  .refine((plan) => plan.stages.filter((stage) => stage.isLost).length === 1, {
    message: "exactly one stage must be isLost",
    path: ["stages"],
  });

export type SetupPlanOutput = z.infer<typeof SETUP_PLAN_SCHEMA>;

export const SETUP_PLAN_SYSTEM_PROMPT = `Sos un asistente que arma la configuración inicial de un CRM para un negocio en Paraguay,
a partir de lo que el dueño contó de su negocio. Respondé únicamente con el JSON pedido, en español
rioplatense/paraguayo (voseo), sin inventar precios ni datos que no estén en el resumen. Elegí
"closestVerticalSlug" entre: ${VERTICAL_PRESETS.map((preset) => `${preset.slug} (${preset.name})`).join(", ")}.`;

/** Clones the closest catalogue preset (§16.5 step 3: "may start from the
 *  closest catalogue preset and adapt") and overlays what the model actually
 *  generated — the stages, tags, quick replies and the two flows it is
 *  allowed to produce. Prices stay null: nothing here invents one. */
export function presetFromOutput(output: SetupPlanOutput): VerticalPreset {
  const base = findPreset(output.closestVerticalSlug) ?? findPreset("generico")!;

  const flows: VerticalPreset["flows"] = [];
  if (output.welcomeMessage) {
    flows.push({
      name: "Bienvenida fuera de horario",
      trigger: "wa_message_received",
      // The graph's wait node requires >=1 minute (flowGraphSchema); a
      // welcome message still reads as immediate at this scale.
      waitMinutes: 1,
      text: output.welcomeMessage,
      conditions: ["outside_business_hours"],
    });
  }
  if (output.reviewRequestMessage) {
    flows.push({
      name: "Pedir reseña",
      trigger: "deal_won",
      waitMinutes: 60,
      text: output.reviewRequestMessage,
    });
  }

  return {
    slug: base.slug,
    name: base.name,
    description: base.description,
    resources: base.resources,
    hours: base.hours,
    bookingTypes:
      output.bookingTypes.length > 0
        ? output.bookingTypes.map((type) => ({ name: type.name, slug: type.slug, durationMinutes: type.durationMinutes }))
        : base.bookingTypes,
    pipelineStages: output.stages,
    tags: output.tags,
    quickReplies: output.quickReplies,
    aiMode: "draft",
    flows,
  };
}
