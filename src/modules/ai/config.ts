import type { BusinessContext } from "@/lib/ai";
import { getProfile, type BusinessProfile } from "@/modules/memory/profile";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantAiSettings, TenantSettings } from "@/modules/tenancy/settings";
import type { TenantContext } from "@/modules/tenancy/context";

// Resolved AI configuration for a tenant (PLAN.md §10 1O). Everything that
// reads tenant AI settings goes through here so the safe defaults exist in
// exactly one place — a tenant row written before 1O, or one where an admin
// cleared a field, resolves to the same conservative values as a brand new
// tenant.

/**
 * "Start every tenant on draft" (§10 1O). This is not a UI default that a
 * missing form field could bypass — an absent or unrecognised `mode` on the
 * settings JSON resolves to draft here, at the read.
 */
export const DEFAULT_MODE = "draft" as const;

/** Hard cap on replies per conversation per day (§10 1O guardrails). */
export const DEFAULT_MAX_PER_CONVERSATION_PER_DAY = 3;

/**
 * Per-tenant daily ceiling. Not in the §10 1O sketch, added because cost is
 * per-token and per-tenant: a misconfigured flow that triggers on every
 * inbound message would otherwise be bounded only by conversation count.
 */
export const DEFAULT_MAX_PER_TENANT_PER_DAY = 200;

/** Inbound message equal to this hands the conversation to a human for good. */
export const DEFAULT_HANDOFF_KEYWORD = "humano";

/** Ceilings an admin can't raise past — a typo in the form can't become a bill. */
export const MAX_PER_CONVERSATION_PER_DAY_LIMIT = 20;
export const MAX_PER_TENANT_PER_DAY_LIMIT = 2000;

export type ResolvedAiConfig = {
  enabled: boolean;
  /**
   * Whether the assistant may offer bookable slots (plan-booking.md §5.3).
   * Off by default and gated per tenant, on the same principle as `mode`: a
   * capability that reaches customers starts switched off.
   */
  bookingEnabled: boolean;
  mode: "draft" | "send";
  maxRepliesPerConversationPerDay: number;
  maxRepliesPerTenantPerDay: number;
  handoffKeyword: string;
  business: BusinessContext;
};

/**
 * The business half of the config now comes from the memory (PLAN.md §16.4),
 * not from `settings.ai`'s free text. `settings.ai` is still read as a
 * fallback for one release — a tenant whose profile row the 0028 migration
 * has not reached, or one created between the migration and their first
 * visit to /settings/negocio, keeps exactly the prompt they had.
 *
 * The *rendered* memory block is not here: it depends on what the customer
 * just asked, so it is built per call by buildMemoryContext and passed to
 * buildSystemPrompt beside this.
 */
export function resolveAiConfig(
  tenantName: string,
  settings: TenantAiSettings | undefined,
  profile?: BusinessProfile | null,
): ResolvedAiConfig {
  return {
    enabled: settings?.enabled === true,
    bookingEnabled: settings?.bookingEnabled === true,
    mode: settings?.mode === "send" ? "send" : DEFAULT_MODE,
    maxRepliesPerConversationPerDay: clamp(
      settings?.maxRepliesPerConversationPerDay,
      DEFAULT_MAX_PER_CONVERSATION_PER_DAY,
      MAX_PER_CONVERSATION_PER_DAY_LIMIT,
    ),
    maxRepliesPerTenantPerDay: clamp(
      settings?.maxRepliesPerTenantPerDay,
      DEFAULT_MAX_PER_TENANT_PER_DAY,
      MAX_PER_TENANT_PER_DAY_LIMIT,
    ),
    handoffKeyword: (settings?.handoffKeyword ?? DEFAULT_HANDOFF_KEYWORD).trim().toLowerCase(),
    business: {
      businessName:
        profile?.displayName?.trim() || settings?.businessName?.trim() || tenantName,
      neverPromise: profile?.neverPromise?.trim() || settings?.neverPromise,
    },
  };
}

function clamp(value: number | undefined, fallback: number, ceiling: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return Math.min(Math.floor(value), ceiling);
}

export async function getAiConfig(ctx: TenantContext): Promise<ResolvedAiConfig> {
  const [tenant, profile] = await Promise.all([getTenant(ctx.tenantId), getProfile(ctx)]);
  const settings = (tenant?.settings ?? {}) as TenantSettings;
  return resolveAiConfig(tenant?.name ?? "", settings.ai, profile);
}
