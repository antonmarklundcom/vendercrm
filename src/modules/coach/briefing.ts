import { eq } from "drizzle-orm";
import { coachBriefings } from "@/db/schema";
import { newId } from "@/lib/ids";
import { getAiDriver } from "@/lib/ai";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getTenant } from "@/modules/tenancy/tenants";
import { getAiConfig } from "@/modules/ai/config";
import { countRepliesTodayForTenant, recordReply } from "@/modules/ai/replies";
import { getProfile } from "@/modules/memory/profile";
import { getSalesReport, type ReportWindow } from "@/modules/reports/sales";
import { buildHoy } from "./hoy";
import type { HoyItemKind } from "./rank";
import {
  BRIEFING_SCHEMA,
  templateNarrative,
  verifyNarrative,
  type BriefingInput,
  type BriefingMetrics,
} from "./narrative";
import { startOfDay, addDays, type DayKey } from "@/modules/calendar/zoned-time";
import { DEFAULT_TIMEZONE } from "@/lib/i18n/format";

// The weekly briefing (PLAN.md §15.3 L2, §17.2/§17.3 P14). `narrative.ts`
// holds the pure half (template text, verification); this file is the DB
// reads that build its input and the row it's stored in.

export type CoachBriefingRow = typeof coachBriefings.$inferSelect;

function windowFor(weekStart: DayKey, timeZone: string, offsetWeeks: 0 | -1): ReportWindow {
  const start = addDays(weekStart, offsetWeeks * 7);
  const end = addDays(start, 7);
  return { from: startOfDay(start, timeZone), to: startOfDay(end, timeZone), days: 7 };
}

/** Every Hoy candidate right now, counted by kind — the closest reading of
 *  "what needed attention" available without a historical snapshot table,
 *  taken at the moment the Monday job runs. */
function countHoyByKind(items: Array<{ kind: HoyItemKind }>): Record<HoyItemKind, number> {
  const counts = {} as Record<HoyItemKind, number>;
  for (const item of items) {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  }
  return counts;
}

export async function buildBriefingInput(
  ctx: TenantContext,
  weekStart: DayKey,
): Promise<BriefingInput> {
  const tenant = await getTenant(ctx.tenantId);
  const timeZone = tenant?.timezone || DEFAULT_TIMEZONE;

  const [thisWeek, lastWeek, hoyItems, profile] = await Promise.all([
    getSalesReport(ctx, windowFor(weekStart, timeZone, 0)),
    getSalesReport(ctx, windowFor(weekStart, timeZone, -1)),
    buildHoy(ctx, startOfDay(weekStart, timeZone)),
    getProfile(ctx),
  ]);

  const hoyCounts = countHoyByKind(hoyItems);

  const metrics: BriefingMetrics = {
    leadsThisWeek: thisWeek.funnel.leads,
    leadsLastWeek: lastWeek.funnel.leads,
    dealsWonThisWeek: thisWeek.funnel.dealsWon,
    dealsWonLastWeek: lastWeek.funnel.dealsWon,
    wonValueThisWeek: thisWeek.funnel.wonValue,
    wonValueLastWeek: lastWeek.funnel.wonValue,
    responseMedianMinutes: thisWeek.response.medianMinutes ?? 0,
    staleDeals: hoyCounts.stale_deal ?? 0,
    unrepliedQuotes: hoyCounts.unreplied_quote ?? 0,
    unansweredConversations: hoyCounts.unread_conversation ?? 0,
    leadsWithoutDeal: hoyCounts.lead_without_deal ?? 0,
  };

  return {
    metrics,
    businessName: profile?.displayName?.trim() || tenant?.name || "",
    currency: thisWeek.funnel.currency,
    locale: tenant?.locale ?? "es",
  };
}

export type BriefingGenerationResult = {
  input: BriefingInput;
  summary: string;
  recommendations: string[];
  source: "ai" | "template";
  aiReplyId: string | null;
};

const BRIEFING_SYSTEM_PROMPT = (businessName: string) =>
  `Sos el coach de ventas de ${businessName}, un negocio en Paraguay. Hablás en voseo argentino/paraguayo, tono cercano y directo. ` +
  `Se te da un conjunto de números de la semana en JSON. Escribí un resumen breve (2-3 oraciones) y exactamente tres recomendaciones concretas y accionables. ` +
  `Usá ÚNICAMENTE los números que se te dieron — nunca inventes una cifra que no esté en el JSON. ` +
  `En "citedMetrics" listá las claves del JSON que efectivamente mencionaste.`;

/**
 * Tries the configured AI driver first — never AI's output as-is: every
 * generation is run through `verifyNarrative`, and anything that fails
 * (invented number, unknown cited key, a thrown error, the daily cap, or no
 * driver at all) falls back to the deterministic template. A ledger row is
 * written on every provider call, whichever way it comes out — the audit
 * trail exists even for a rejected generation.
 */
export async function generateBriefing(
  ctx: TenantContext,
  weekStart: DayKey,
): Promise<BriefingGenerationResult> {
  const input = await buildBriefingInput(ctx, weekStart);
  const fallback = templateNarrative(input);
  const asTemplate = (): BriefingGenerationResult => ({
    input,
    summary: fallback.summary,
    recommendations: fallback.recommendations,
    source: "template",
    aiReplyId: null,
  });

  const driver = getAiDriver();
  if (!driver) return asTemplate();

  const config = await getAiConfig(ctx);
  const usedToday = await countRepliesTodayForTenant(ctx);
  if (usedToday >= config.maxRepliesPerTenantPerDay) return asTemplate();

  const system = BRIEFING_SYSTEM_PROMPT(input.businessName);
  const prompt = JSON.stringify(input.metrics);

  try {
    const result = await driver.generateStructured({
      system,
      messages: [{ role: "user", content: `Números de la semana: ${prompt}` }],
      schema: BRIEFING_SCHEMA,
      schemaName: "weekly_briefing",
    });

    const verified = verifyNarrative(result.data, input);

    const reply = await recordReply(ctx, {
      kind: "weekly_briefing",
      mode: "send",
      status: verified ? "sent" : "failed",
      prompt: `${system}\n\n${prompt}`,
      body: result.raw,
      provider: driver.provider,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      error: verified ? undefined : "narrative_verification_failed",
    });

    if (verified) {
      return {
        input,
        summary: result.data.summary,
        recommendations: result.data.recommendations,
        source: "ai",
        aiReplyId: reply?.id ?? null,
      };
    }
  } catch {
    // Falls through to the template — an AI failure must never mean no
    // briefing at all.
  }

  return asTemplate();
}

/**
 * Generates and stores this week's briefing. Idempotent by the unique index
 * on (tenant_id, week_start): a caught insert conflict means a briefing for
 * this week already exists and this call returns null rather than a second
 * row — the no-op a re-run of the hourly chain relies on.
 */
export async function createWeeklyBriefing(
  ctx: TenantContext,
  weekStart: DayKey,
): Promise<CoachBriefingRow | null> {
  const tenant = await getTenant(ctx.tenantId);
  const timeZone = tenant?.timezone || DEFAULT_TIMEZONE;
  const generation = await generateBriefing(ctx, weekStart);

  const id = newId();
  try {
    await tenantDb(ctx)
      .insert(coachBriefings)
      .values({
        id,
        weekStart: startOfDay(weekStart, timeZone),
        metrics: generation.input.metrics,
        narrative: generation.summary,
        recommendations: generation.recommendations,
        source: generation.source,
        aiReplyId: generation.aiReplyId,
      });
  } catch {
    return null;
  }

  return getBriefing(ctx, id);
}

export async function getBriefing(ctx: TenantContext, id: string): Promise<CoachBriefingRow | null> {
  const [row] = await tenantDb(ctx).select(coachBriefings, eq(coachBriefings.id, id));
  return row ?? null;
}

export async function listBriefings(ctx: TenantContext): Promise<CoachBriefingRow[]> {
  const rows = await tenantDb(ctx).select(coachBriefings);
  return rows.sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime());
}

export async function getLatestBriefing(ctx: TenantContext): Promise<CoachBriefingRow | null> {
  const rows = await listBriefings(ctx);
  return rows[0] ?? null;
}
