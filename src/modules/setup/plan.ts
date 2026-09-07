import { eq } from "drizzle-orm";
import { setupPlans } from "@/db/schema";
import { newId } from "@/lib/ids";
import { getAiDriver } from "@/lib/ai";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getAiConfig } from "@/modules/ai/config";
import { countRepliesTodayForTenant, recordReply } from "@/modules/ai/replies";
import { getProfile, profileInputSchema, upsertProfile } from "@/modules/memory/profile";
import { createFact, listFacts, ALWAYS_KINDS, RETRIEVABLE_KINDS } from "@/modules/memory/facts";
import type { VerticalPreset } from "@/modules/tenancy/verticals";
import {
  INITIAL_CONVERSATION_STATE,
  advanceConversation,
  matchTone,
  parseFaqBlocks,
  type SetupConversationState,
  type SetupTopic,
} from "./conversation";
import { SETUP_PLAN_SCHEMA, SETUP_PLAN_SYSTEM_PROMPT, presetFromOutput } from "./schema";

export { SETUP_PLAN_SCHEMA } from "./schema";
export type { SetupPlanOutput } from "./schema";

// Plan generation (PLAN.md §16.5 step 3): one JSON-mode call with the whole
// memory as input, the extended preset shape as the output, one retry on
// invalid — all of which `driver.generateStructured` already does (K1).
// This file is only what's specific to the setup assistant: the brief, the
// output schema, and turning that output into a full `VerticalPreset` by
// starting from the catalogue preset the business reads closest to.

export type SetupPlanRow = typeof setupPlans.$inferSelect;

/** The one setup conversation in progress for a tenant — there is only ever
 *  one at a time, so "the draft" needs no id from the caller. */
export async function getDraftSetupPlan(ctx: TenantContext): Promise<SetupPlanRow | null> {
  const rows = await tenantDb(ctx).select(setupPlans, eq(setupPlans.status, "draft"));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}

export async function getSetupPlan(ctx: TenantContext, id: string): Promise<SetupPlanRow | null> {
  const [row] = await tenantDb(ctx).select(setupPlans, eq(setupPlans.id, id));
  return row ?? null;
}

/** Creates the draft row on the conversation's first answer, updates its
 *  saved progress on every one after. */
export async function upsertSetupPlanConversation(
  ctx: TenantContext,
  state: SetupConversationState,
): Promise<SetupPlanRow> {
  const existing = await getDraftSetupPlan(ctx);
  if (existing) {
    await tenantDb(ctx)
      .update(setupPlans)
      .set({ conversation: state, updatedAt: new Date() })
      .where(eq(setupPlans.id, existing.id));
    return (await getSetupPlan(ctx, existing.id))!;
  }

  const id = newId();
  await tenantDb(ctx)
    .insert(setupPlans)
    .values({ id, status: "draft", conversation: state, createdBy: ctx.userId });
  return (await getSetupPlan(ctx, id))!;
}

/** Everything the memory knows, folded into the one summary the plan is
 *  generated from (§16.4: "Setup assistant | everything, including internal"). */
export async function buildSetupBrief(ctx: TenantContext): Promise<string> {
  const [profile, facts] = await Promise.all([
    getProfile(ctx),
    listFacts(ctx, { kind: [...ALWAYS_KINDS, ...RETRIEVABLE_KINDS] }),
  ]);

  const lines: string[] = [];
  if (profile?.about) lines.push(`Qué hace y para quién: ${profile.about}`);
  if (profile?.address) lines.push(`Dirección: ${profile.address}`);
  if (profile?.tone) lines.push(`Tono: ${profile.tone}${profile.toneNote ? ` (${profile.toneNote})` : ""}`);
  if (profile?.neverPromise) lines.push(`Nunca debe prometer: ${profile.neverPromise}`);
  for (const fact of facts) {
    lines.push(`[${fact.kind}] ${fact.title}${fact.body ? `: ${fact.body}` : ""}`);
  }
  return lines.join("\n");
}

export type GenerateSetupPlanResult =
  | { ok: true; planId: string; preset: VerticalPreset; brief: string }
  | { ok: false; reason: "ai_unavailable" | "daily_cap_reached" | "generation_failed" };

/**
 * One structured call, the memory as input, the extended preset shape as
 * output (§16.5 step 3). Never throws: every failure mode the assistant must
 * survive (no driver configured, the tenant's daily cap, a model that never
 * produces valid JSON after its retry) comes back as a reason instead, so the
 * caller can fall back to the plain picker per K2's exit criterion.
 */
export async function generateSetupPlan(ctx: TenantContext): Promise<GenerateSetupPlanResult> {
  const driver = getAiDriver();
  if (!driver) return { ok: false, reason: "ai_unavailable" };

  const config = await getAiConfig(ctx);
  const usedToday = await countRepliesTodayForTenant(ctx);
  if (usedToday >= config.maxRepliesPerTenantPerDay) return { ok: false, reason: "daily_cap_reached" };

  const brief = await buildSetupBrief(ctx);
  const plan = await getDraftSetupPlan(ctx);

  try {
    const result = await driver.generateStructured({
      system: SETUP_PLAN_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Resumen del negocio:\n${brief || "(sin datos todavía)"}` }],
      schema: SETUP_PLAN_SCHEMA,
      schemaName: "setup_plan",
    });

    const reply = await recordReply(ctx, {
      kind: "setup_plan",
      mode: "send",
      status: "sent",
      prompt: `${SETUP_PLAN_SYSTEM_PROMPT}\n\n${brief}`,
      body: result.raw,
      provider: driver.provider,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    });

    const preset = presetFromOutput(result.data);

    const id = plan?.id ?? newId();
    if (plan) {
      await tenantDb(ctx)
        .update(setupPlans)
        .set({ brief, preset, aiReplyId: reply?.id ?? null, updatedAt: new Date() })
        .where(eq(setupPlans.id, plan.id));
    } else {
      await tenantDb(ctx)
        .insert(setupPlans)
        .values({ id, status: "draft", brief, preset, aiReplyId: reply?.id ?? null, createdBy: ctx.userId });
    }

    return { ok: true, planId: id, preset, brief };
  } catch {
    // An AI failure here must fall back to the manual picker, never throw
    // into a page render (same discipline as the weekly briefing's template
    // fallback).
    await recordReply(ctx, {
      kind: "setup_plan",
      mode: "send",
      status: "failed",
      prompt: `${SETUP_PLAN_SYSTEM_PROMPT}\n\n${brief}`,
      body: "",
      provider: driver.provider,
      model: "",
      promptTokens: 0,
      completionTokens: 0,
      error: "setup_plan_generation_failed",
    });
    return { ok: false, reason: "generation_failed" };
  }
}

/**
 * Writes one topic's answer into the memory (§16.5 step 2: "each answer is
 * written to the memory as a confirmed fact"). Merges into the existing
 * profile rather than replacing it — unlike the settings form, which submits
 * every field at once, the conversation writes one field per topic and must
 * not blank out the others already answered.
 */
async function patchProfile(ctx: TenantContext, patch: Record<string, unknown>): Promise<void> {
  const existing = await getProfile(ctx);
  const merged = profileInputSchema.parse({
    displayName: existing?.displayName,
    legalName: existing?.legalName,
    ruc: existing?.ruc,
    about: existing?.about,
    tone: existing?.tone,
    toneNote: existing?.toneNote,
    audience: existing?.audience,
    differentiators: existing?.differentiators,
    website: existing?.website,
    address: existing?.address,
    mapsUrl: existing?.mapsUrl,
    neverPromise: existing?.neverPromise,
    paymentMethods: existing?.paymentMethods,
    ...patch,
  });
  await upsertProfile(ctx, merged);
}

async function applyAnswer(ctx: TenantContext, topic: SetupTopic, answer: string): Promise<void> {
  switch (topic) {
    case "about":
      await patchProfile(ctx, { about: answer });
      return;
    case "contactToday":
      await createFact(
        ctx,
        { kind: "contact", title: "Cómo te contactan hoy", body: answer, visibility: "internal" },
        { confirmedByUserId: ctx.userId },
      );
      return;
    case "hoursAddress":
      await Promise.all([
        patchProfile(ctx, { address: answer }),
        createFact(
          ctx,
          { kind: "location", title: "Horario y dirección", body: answer, visibility: "customer" },
          { confirmedByUserId: ctx.userId },
        ),
      ]);
      return;
    case "servicesPrices":
      await createFact(
        ctx,
        { kind: "service", title: "Servicios y precios", body: answer, visibility: "customer" },
        { confirmedByUserId: ctx.userId },
      );
      return;
    case "policies":
      await createFact(
        ctx,
        {
          kind: "policy",
          title: "Señas, cancelación y pagos",
          body: answer,
          visibility: "customer",
          structured: { topic: "cancellation" },
        },
        { confirmedByUserId: ctx.userId },
      );
      return;
    case "faqs":
      for (const faq of parseFaqBlocks(answer)) {
        await createFact(
          ctx,
          { kind: "faq", title: faq.title, body: faq.body, visibility: "customer" },
          { confirmedByUserId: ctx.userId },
        );
      }
      return;
    case "tone": {
      const { tone, note } = matchTone(answer);
      await patchProfile(ctx, { tone, toneNote: note });
      return;
    }
    case "neverPromise":
      await patchProfile(ctx, { neverPromise: answer });
      return;
  }
}

/**
 * Advances the tenant's one in-progress draft plan by one topic, applying
 * the answer to the memory and persisting the new conversation state so a
 * reload resumes here (§16.5 step 2). Creates the draft row on the first
 * call — there is exactly one in-progress conversation per tenant at a time.
 */
export async function submitSetupAnswer(
  ctx: TenantContext,
  input: { topic: SetupTopic; answer?: string; skip?: boolean },
): Promise<SetupConversationState> {
  const plan = await getDraftSetupPlan(ctx);
  const state = (plan?.conversation as SetupConversationState | undefined) ?? INITIAL_CONVERSATION_STATE;

  if (!input.skip && input.answer?.trim()) {
    await applyAnswer(ctx, input.topic, input.answer.trim());
  }

  const next = advanceConversation(state, input);
  await upsertSetupPlanConversation(ctx, next);
  return next;
}
