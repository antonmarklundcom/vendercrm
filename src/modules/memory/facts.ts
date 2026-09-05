import { and, asc, desc, eq, inArray, isNotNull, isNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import { businessFacts } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";

// The many-rows half of the memory (PLAN.md §16.3).
//
// Two rules are enforced here rather than by the caller, because a caller
// that forgets either one leaks: `visibility: internal` is a WHERE clause on
// every customer-facing read (§16.2 rule 5), and an `ai_suggested` fact is
// not readable by a prompt until `confirmed_at` is set (§16.2 rule 2).

export type BusinessFact = typeof businessFacts.$inferSelect;

export const FACT_KINDS = [
  "faq",
  "service",
  "policy",
  "location",
  "contact",
  "promo",
  "note",
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const POLICY_TOPICS = [
  "cancellation",
  "deposit",
  "payment",
  "warranty",
  "other",
] as const;
export type PolicyTopic = (typeof POLICY_TOPICS)[number];

/** Kinds a customer-facing prompt retrieves by relevance to what was asked. */
export const RETRIEVABLE_KINDS = ["faq", "service"] as const;
/** Kinds that are always included, budget permitting (§16.4). */
export const ALWAYS_KINDS = ["policy", "location", "contact"] as const;

const serviceStructured = z.object({
  /** Guaraníes, as a whole number. Absent means "we don't quote a price here". */
  price: z.number().int().min(0).nullable().optional(),
  priceFrom: z.boolean().optional(),
  durationMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
  bookingTypeId: z.string().max(26).nullable().optional(),
});

const promoStructured = z.object({
  validFrom: z.string().date().nullable().optional(),
  validUntil: z.string().date().nullable().optional(),
});

const policyStructured = z.object({ topic: z.enum(POLICY_TOPICS) });

/**
 * Per-kind validation of the `structured` column. Anything else is stored as
 * an empty object rather than rejected — a note has no structure, and a
 * future kind should not need a migration to be storable.
 */
export function parseStructured(
  kind: FactKind,
  value: unknown,
): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case "service":
      return serviceStructured.parse(value);
    case "promo":
      return promoStructured.parse(value);
    case "policy":
      return policyStructured.parse(value);
    default:
      return null;
  }
}

export const factInputSchema = z.object({
  kind: z.enum(FACT_KINDS),
  title: z.string().trim().min(1).max(300),
  body: z
    .string()
    .trim()
    .max(5000)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
  structured: z.unknown().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  visibility: z.enum(["customer", "internal"]).default("customer"),
  reviewAfter: z.date().nullable().optional(),
});

export type FactInput = z.infer<typeof factInputSchema>;

export type ListFactsOptions = {
  kind?: FactKind | FactKind[];
  visibility?: "customer" | "internal";
  /** Only facts a human has confirmed — what every prompt reads. */
  confirmedOnly?: boolean;
};

function listFilter(options: ListFactsOptions): SQL | undefined {
  const clauses: SQL[] = [];
  if (options.kind) {
    const kinds = Array.isArray(options.kind) ? options.kind : [options.kind];
    clauses.push(inArray(businessFacts.kind, kinds));
  }
  if (options.visibility) clauses.push(eq(businessFacts.visibility, options.visibility));
  if (options.confirmedOnly) clauses.push(isNotNull(businessFacts.confirmedAt));
  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : (and(...clauses) as SQL);
}

/**
 * Deterministic order — kind, then title, then id — because two of the
 * callers are a prompt and a test, and a prompt whose facts arrive in a
 * different order on every call is neither cacheable nor diffable.
 */
export async function listFacts(
  ctx: TenantContext,
  options: ListFactsOptions = {},
): Promise<BusinessFact[]> {
  return tenantDb(ctx)
    .select(businessFacts, listFilter(options))
    .orderBy(asc(businessFacts.kind), asc(businessFacts.title), asc(businessFacts.id));
}

export async function getFact(ctx: TenantContext, id: string): Promise<BusinessFact | null> {
  const [row] = await tenantDb(ctx).select(businessFacts, eq(businessFacts.id, id)).limit(1);
  return row ?? null;
}

export type CreateFactOptions = {
  source?: "manual" | "imported" | "ai_suggested";
  /** Who typed it. A fact a person wrote is confirmed by the writing. */
  confirmedByUserId?: string;
};

export async function createFact(
  ctx: TenantContext,
  input: FactInput,
  options: CreateFactOptions = {},
): Promise<BusinessFact | null> {
  const source = options.source ?? "manual";
  const id = newId();
  // An AI-suggested fact is never born confirmed — that is the whole of
  // §16.2 rule 2, and it is decided here rather than by whoever calls this.
  const confirmed = source !== "ai_suggested";

  await tenantDb(ctx)
    .insert(businessFacts)
    .values({
      id,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      structured: parseStructured(input.kind, input.structured),
      tags: input.tags ?? null,
      visibility: input.visibility,
      source,
      confirmedAt: confirmed ? new Date() : null,
      confirmedByUserId: confirmed ? (options.confirmedByUserId ?? null) : null,
      reviewAfter: input.reviewAfter ?? null,
    });

  return getFact(ctx, id);
}

/**
 * An edit re-confirms: an admin who rewrote the text has vouched for it, so
 * a corrected AI suggestion becomes usable without a second click.
 */
export async function updateFact(
  ctx: TenantContext,
  id: string,
  input: FactInput,
  confirmedByUserId?: string,
): Promise<BusinessFact | null> {
  await tenantDb(ctx)
    .update(businessFacts)
    .set({
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      structured: parseStructured(input.kind, input.structured),
      tags: input.tags ?? null,
      visibility: input.visibility,
      confirmedAt: new Date(),
      confirmedByUserId: confirmedByUserId ?? null,
      reviewAfter: input.reviewAfter ?? null,
      updatedAt: new Date(),
    })
    .where(eq(businessFacts.id, id));
  return getFact(ctx, id);
}

export async function confirmFact(
  ctx: TenantContext,
  id: string,
  confirmedByUserId: string,
): Promise<BusinessFact | null> {
  await tenantDb(ctx)
    .update(businessFacts)
    .set({ confirmedAt: new Date(), confirmedByUserId, updatedAt: new Date() })
    .where(eq(businessFacts.id, id));
  return getFact(ctx, id);
}

export async function deleteFact(ctx: TenantContext, id: string): Promise<void> {
  await tenantDb(ctx).delete(businessFacts, eq(businessFacts.id, id));
}

/** Newest first — the import review queue in K3 reads this. */
export async function listUnconfirmedFacts(ctx: TenantContext): Promise<BusinessFact[]> {
  return tenantDb(ctx)
    .select(
      businessFacts,
      and(eq(businessFacts.source, "ai_suggested"), isNull(businessFacts.confirmedAt)) as SQL,
    )
    .orderBy(desc(businessFacts.createdAt));
}
