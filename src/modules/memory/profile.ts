import { eq } from "drizzle-orm";
import { z } from "zod";
import { businessProfiles } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { completedPct, TONES } from "./checklist";

// Re-exported so a caller needs one import for "the profile", pure parts
// included; the definitions live in ./checklist.
export {
  completedPct,
  memoryChecklist,
  profileFromLegacyAiSettings,
  TONES,
  type ChecklistInput,
  type ChecklistKey,
  type ChecklistRow,
  type Tone,
} from "./checklist";

// The one row per tenant half of the memory (PLAN.md §16.3). Everything here
// is data a form edits and the prompt builder reads; nothing branches on it.

export type BusinessProfile = typeof businessProfiles.$inferSelect;

const trimmedOrNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional()
    .transform((value) => value ?? null);

export const profileInputSchema = z.object({
  displayName: trimmedOrNull(200),
  legalName: trimmedOrNull(200),
  ruc: trimmedOrNull(30),
  about: trimmedOrNull(4000),
  tone: z.enum(TONES).nullable().optional().transform((value) => value ?? null),
  toneNote: trimmedOrNull(500),
  audience: trimmedOrNull(2000),
  differentiators: trimmedOrNull(2000),
  website: trimmedOrNull(500),
  address: trimmedOrNull(500),
  mapsUrl: trimmedOrNull(2000),
  neverPromise: trimmedOrNull(2000),
  paymentMethods: z
    .array(z.string().trim().min(1).max(100))
    .max(20)
    .optional()
    .transform((value) => value ?? []),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;

export async function getProfile(ctx: TenantContext): Promise<BusinessProfile | null> {
  const [row] = await tenantDb(ctx).select(businessProfiles).limit(1);
  return row ?? null;
}

/**
 * Creates the row on first write and merges into it afterwards. One row per
 * tenant is a unique index, not a convention, so a racing second writer gets
 * a duplicate-key error rather than a second memory.
 */
export async function upsertProfile(
  ctx: TenantContext,
  input: ProfileInput,
): Promise<BusinessProfile | null> {
  const existing = await getProfile(ctx);
  const values = {
    ...input,
    paymentMethods: input.paymentMethods,
    updatedAt: new Date(),
  };

  if (existing) {
    await tenantDb(ctx)
      .update(businessProfiles)
      .set(values)
      .where(eq(businessProfiles.id, existing.id));
  } else {
    await tenantDb(ctx)
      .insert(businessProfiles)
      .values({ id: newId(), ...values });
  }

  return getProfile(ctx);
}

/** The vertical the setup assistant applied. Bookkeeping only (K2 writes it). */
export async function setProfileVertical(ctx: TenantContext, verticalSlug: string) {
  const existing = await getProfile(ctx);
  if (!existing) return null;
  await tenantDb(ctx)
    .update(businessProfiles)
    .set({ verticalSlug, updatedAt: new Date() })
    .where(eq(businessProfiles.id, existing.id));
  return getProfile(ctx);
}

/**
 * Recomputes and caches the percentage. Called after every write to the
 * memory — cheap (two indexed reads) and it keeps the dashboard number from
 * drifting away from the checklist the admin is looking at.
 */
export async function refreshCompletedPct(
  ctx: TenantContext,
  hasBusinessHours: boolean,
): Promise<number> {
  const { listFacts } = await import("./facts");
  const [profile, facts] = await Promise.all([getProfile(ctx), listFacts(ctx, {})]);
  const pct = completedPct({ profile, facts, hasBusinessHours });
  if (profile && profile.completedPct !== pct) {
    await tenantDb(ctx)
      .update(businessProfiles)
      .set({ completedPct: pct })
      .where(eq(businessProfiles.id, profile.id));
  }
  return pct;
}
