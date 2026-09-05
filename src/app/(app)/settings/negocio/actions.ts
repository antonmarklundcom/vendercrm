"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTenantAdmin } from "@/modules/tenancy/context";
import { writeAuditLog } from "@/modules/tenancy/audit";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import {
  confirmFact,
  createFact,
  deleteFact,
  factInputSchema,
  getFact,
  updateFact,
  FACT_KINDS,
  POLICY_TOPICS,
  type FactKind,
} from "@/modules/memory/facts";
import { profileInputSchema, refreshCompletedPct, upsertProfile } from "@/modules/memory/profile";

// Memoria del negocio — the admin's own edits (PLAN.md §16.2 rule 7:
// "confirming, editing or deleting a fact … write writeAuditLog entries").
//
// Same form contract as /settings (§10 1R #6): safeParse, an error *key* the
// client resolves through next-intl, and a `saved` flag so a successful save
// is visible on a form that looks identical afterwards.

export type MemoryFormState = {
  error: string | null;
  saved: boolean;
  values: Record<string, string>;
};

function submitted(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/** Comma- or newline-separated, the way an admin actually types a list. */
function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 20);
}

/** Whether the tenant has a structured week configured — the checklist row. */
async function hasBusinessHours(tenantId: string): Promise<boolean> {
  const tenant = await getTenant(tenantId);
  const hours = (tenant?.settings as TenantSettings | null)?.businessHours;
  return !!hours && Object.values(hours).some((day) => day !== null);
}

export async function updateProfileAction(
  _prevState: MemoryFormState,
  formData: FormData,
): Promise<MemoryFormState> {
  const ctx = await requireTenantAdmin();
  const values = submitted(formData);

  const parsed = profileInputSchema.safeParse({
    displayName: text(formData, "displayName"),
    legalName: text(formData, "legalName"),
    ruc: text(formData, "ruc"),
    about: text(formData, "about"),
    tone: text(formData, "tone") || undefined,
    toneNote: text(formData, "toneNote"),
    audience: text(formData, "audience"),
    differentiators: text(formData, "differentiators"),
    website: text(formData, "website"),
    address: text(formData, "address"),
    mapsUrl: text(formData, "mapsUrl"),
    neverPromise: text(formData, "neverPromise"),
    paymentMethods: list(text(formData, "paymentMethods")),
  });
  if (!parsed.success) return { error: "invalid", saved: false, values };

  try {
    await upsertProfile(ctx, parsed.data);
    await refreshCompletedPct(ctx, await hasBusinessHours(ctx.tenantId));
  } catch {
    return { error: "unknown", saved: false, values };
  }

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    impersonatorUserId: ctx.impersonatorUserId,
    action: "memory.profile_updated",
    entity: "business_profile",
    entityId: ctx.tenantId,
  });

  revalidatePath("/settings/negocio");
  return { error: null, saved: true, values: {} };
}

const kindSchema = z.enum(FACT_KINDS);

/**
 * The per-kind `structured` payload, assembled from the form's flat fields.
 * Anything the kind does not use is dropped here rather than stored empty —
 * `parseStructured` in the module validates what survives.
 */
function structuredFrom(kind: FactKind, formData: FormData): unknown {
  if (kind === "service") {
    const price = text(formData, "price");
    const duration = text(formData, "durationMinutes");
    return {
      price: price && price.trim() ? Number(price.replace(/\D/g, "")) : null,
      priceFrom: formData.get("priceFrom") === "on",
      durationMinutes: duration && duration.trim() ? Number(duration) : null,
    };
  }
  if (kind === "promo") {
    return {
      validFrom: text(formData, "validFrom") || null,
      validUntil: text(formData, "validUntil") || null,
    };
  }
  if (kind === "policy") {
    const topic = text(formData, "topic");
    return { topic: (POLICY_TOPICS as readonly string[]).includes(topic ?? "") ? topic : "other" };
  }
  return undefined;
}

function parseFact(formData: FormData) {
  const kind = kindSchema.safeParse(text(formData, "kind"));
  if (!kind.success) return null;
  const parsed = factInputSchema.safeParse({
    kind: kind.data,
    title: text(formData, "title"),
    body: text(formData, "body"),
    structured: structuredFrom(kind.data, formData),
    tags: list(text(formData, "tags")),
    visibility: text(formData, "visibility") === "internal" ? "internal" : "customer",
  });
  return parsed.success ? parsed.data : null;
}

export async function createFactAction(
  _prevState: MemoryFormState,
  formData: FormData,
): Promise<MemoryFormState> {
  const ctx = await requireTenantAdmin();
  const values = submitted(formData);

  const input = parseFact(formData);
  if (!input) return { error: "invalid", saved: false, values };

  let created;
  try {
    created = await createFact(ctx, input, { confirmedByUserId: ctx.userId });
    await refreshCompletedPct(ctx, await hasBusinessHours(ctx.tenantId));
  } catch {
    return { error: "unknown", saved: false, values };
  }

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    impersonatorUserId: ctx.impersonatorUserId,
    action: "memory.fact_created",
    entity: "business_fact",
    entityId: created?.id ?? "",
    payload: { kind: input.kind, title: input.title, visibility: input.visibility },
  });

  revalidatePath("/settings/negocio");
  // Cleared, not echoed: the add form is reused for the next fact.
  return { error: null, saved: true, values: {} };
}

export async function updateFactAction(
  _prevState: MemoryFormState,
  formData: FormData,
): Promise<MemoryFormState> {
  const ctx = await requireTenantAdmin();
  const values = submitted(formData);

  const id = text(formData, "id") ?? "";
  const input = parseFact(formData);
  if (!input || !id) return { error: "invalid", saved: false, values };
  // Scoped read first: an id from another tenant resolves to nothing here,
  // so the update below can never reach a row this admin does not own.
  if (!(await getFact(ctx, id))) return { error: "notFound", saved: false, values };

  try {
    await updateFact(ctx, id, input, ctx.userId);
    await refreshCompletedPct(ctx, await hasBusinessHours(ctx.tenantId));
  } catch {
    return { error: "unknown", saved: false, values };
  }

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    impersonatorUserId: ctx.impersonatorUserId,
    action: "memory.fact_updated",
    entity: "business_fact",
    entityId: id,
    payload: { kind: input.kind, title: input.title, visibility: input.visibility },
  });

  revalidatePath("/settings/negocio");
  return { error: null, saved: true, values };
}

export async function confirmFactAction(
  _prevState: MemoryFormState,
  formData: FormData,
): Promise<MemoryFormState> {
  const ctx = await requireTenantAdmin();
  const id = text(formData, "id") ?? "";
  if (!id || !(await getFact(ctx, id))) {
    return { error: "notFound", saved: false, values: {} };
  }

  try {
    await confirmFact(ctx, id, ctx.userId);
    await refreshCompletedPct(ctx, await hasBusinessHours(ctx.tenantId));
  } catch {
    return { error: "unknown", saved: false, values: {} };
  }

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    impersonatorUserId: ctx.impersonatorUserId,
    action: "memory.fact_confirmed",
    entity: "business_fact",
    entityId: id,
  });

  revalidatePath("/settings/negocio");
  return { error: null, saved: true, values: {} };
}

export async function deleteFactAction(
  _prevState: MemoryFormState,
  formData: FormData,
): Promise<MemoryFormState> {
  const ctx = await requireTenantAdmin();
  const id = text(formData, "id") ?? "";
  const existing = id ? await getFact(ctx, id) : null;
  if (!existing) return { error: "notFound", saved: false, values: {} };

  try {
    await deleteFact(ctx, id);
    await refreshCompletedPct(ctx, await hasBusinessHours(ctx.tenantId));
  } catch {
    return { error: "unknown", saved: false, values: {} };
  }

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    impersonatorUserId: ctx.impersonatorUserId,
    action: "memory.fact_deleted",
    entity: "business_fact",
    entityId: id,
    // The deleted row's own words, because after this the row is gone and
    // the audit line is the only record of what the assistant used to know.
    payload: { kind: existing.kind, title: existing.title },
  });

  revalidatePath("/settings/negocio");
  return { error: null, saved: true, values: {} };
}
