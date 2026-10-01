"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTenantAdmin } from "@/modules/tenancy/context";
import { createSite, updateSite, getSiteBySlug } from "@/modules/sites/sites";
import { issueApiKey, revokeApiKey } from "@/modules/sites/keys";
import { setSiteTurnstile, clearSiteTurnstile } from "@/modules/sites/settings";
import {
  issueHookToken,
  revokeHookToken,
  setSiteHookMapping,
  clearHookCaptures,
} from "@/modules/sites/hooks";
import { saveSiteFieldSettings, type FieldLabelError } from "@/modules/sites/field-labels";
import { getStage } from "@/modules/crm/pipelines";
import { checkPlanLimit } from "@/modules/tenancy/limits";

// A stage already belongs to exactly one pipeline, so the UI only ever asks
// for the stage and the pipeline is derived here. Sending both from the
// client would let them drift out of sync.
async function pipelineForStage(
  ctx: Awaited<ReturnType<typeof requireTenantAdmin>>,
  stageId: string | undefined,
) {
  if (!stageId) return undefined;
  const stage = await getStage(ctx, stageId);
  return stage?.pipelineId;
}

// A freshly issued key is shown exactly once (§5.1). It's passed back to the
// page through a redirect param rather than stored anywhere — the hash is
// all the database ever holds.

const createSiteSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/),
  domain: z.string().max(255).optional().or(z.literal("")),
  defaultStageId: z.string().optional().or(z.literal("")),
  waAccountId: z.string().optional().or(z.literal("")),
});

// useActionState-shaped (PLAN.md §10 1R #6): a missing name or a bad slug
// comes back inline instead of throwing to Next's error page. The one-time
// API key still comes back the same way it always did — through state —
// since it's never persisted in plaintext (§5.1).
export type SiteField = "name" | "slug";

export type CreateSiteFormState = {
  error: string | null;
  field: SiteField | null;
  values: Record<string, string>;
  apiKey: string | null;
};

const SITE_FIELD_ERRORS: Record<SiteField, string> = {
  name: "nameRequired",
  slug: "slugInvalid",
};

export async function createSiteAction(
  _prevState: CreateSiteFormState,
  formData: FormData,
): Promise<CreateSiteFormState> {
  const ctx = await requireTenantAdmin();
  const values = Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  const parsed = createSiteSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    domain: formData.get("domain") || undefined,
    defaultStageId: formData.get("defaultStageId") || undefined,
    waAccountId: formData.get("waAccountId") || undefined,
  });

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (typeof field === "string" && field in SITE_FIELD_ERRORS) {
      const key = field as SiteField;
      return { error: SITE_FIELD_ERRORS[key], field: key, values, apiKey: null };
    }
    return { error: "unknown", field: null, values, apiKey: null };
  }

  const existing = await getSiteBySlug(ctx, parsed.data.slug);
  if (existing) {
    return { error: "slugTaken", field: "slug", values, apiKey: null };
  }

  // Connected-site ceiling from the plan (PLAN.md §13 H6).
  const limit = await checkPlanLimit(ctx.tenantId, "maxSitesConnected");
  if (!limit.allowed) {
    return { error: "planLimit", field: null, values, apiKey: null };
  }

  let created;
  try {
    created = await createSite(ctx, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      domain: parsed.data.domain || undefined,
      defaultStageId: parsed.data.defaultStageId || undefined,
      defaultPipelineId: await pipelineForStage(ctx, parsed.data.defaultStageId || undefined),
      waAccountId: parsed.data.waAccountId || undefined,
    });
  } catch {
    // A lost race on the unique index is still not worth a 500 mid-form.
    return { error: "slugTaken", field: "slug", values, apiKey: null };
  }

  revalidatePath("/sites");
  return { error: null, field: null, values: {}, apiKey: created.apiKey };
}

// Two-active-key rotation (PLAN.md §5.2). Issuing no longer overwrites: a
// site can hold two live keys, so the sequence is issue → deploy → revoke
// with no window where the live site holds a key the CRM rejects.
export type IssueKeyState = {
  /** Shown exactly once (§5.1) — never persisted in plaintext. */
  apiKey: string | null;
  error: string | null;
};

const issueKeySchema = z.object({
  siteId: z.string().min(1),
  label: z.string().max(100).optional(),
});

export async function issueApiKeyAction(
  _prev: IssueKeyState,
  formData: FormData,
): Promise<IssueKeyState> {
  const ctx = await requireTenantAdmin();
  const parsed = issueKeySchema.safeParse({
    siteId: formData.get("siteId"),
    label: (formData.get("label") ?? "").toString().trim() || undefined,
  });
  if (!parsed.success) return { apiKey: null, error: "unknown" };

  const issued = await issueApiKey(ctx, parsed.data.siteId, parsed.data.label);
  if (!issued.ok) return { apiKey: null, error: issued.error };

  revalidatePath("/sites");
  return { apiKey: issued.plaintext, error: null };
}

const revokeKeySchema = z.object({
  siteId: z.string().min(1),
  keyId: z.string().min(1),
});

export async function revokeApiKeyAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = revokeKeySchema.safeParse({
    siteId: formData.get("siteId"),
    keyId: formData.get("keyId"),
  });
  if (!parsed.success) return;
  await revokeApiKey(ctx, parsed.data.siteId, parsed.data.keyId);
  revalidatePath("/sites");
}

// Per-site Cloudflare Turnstile (PLAN.md §5.2). useActionState-shaped like
// every other user-fillable form (§10 1R #6) — but the secret is excluded
// from the echoed values, the same rule connectAccountAction follows for a
// WhatsApp token (§3.4): `values` is serialized to the browser.
export type TurnstileFormState = {
  error: string | null;
  saved: boolean;
  values: { turnstileSiteKey?: string };
};

const turnstileSchema = z.object({
  siteId: z.string().min(1),
  siteKey: z.string().min(1).max(200),
  secret: z.string().min(1).max(300),
  requireOnIngest: z.boolean(),
});

export async function saveSiteTurnstileAction(
  _prev: TurnstileFormState,
  formData: FormData,
): Promise<TurnstileFormState> {
  const ctx = await requireTenantAdmin();
  const siteKey = (formData.get("turnstileSiteKey") ?? "").toString().trim();

  const parsed = turnstileSchema.safeParse({
    siteId: formData.get("siteId"),
    siteKey,
    secret: (formData.get("turnstileSecret") ?? "").toString().trim(),
    requireOnIngest: formData.get("requireOnIngest") === "on",
  });

  if (!parsed.success) {
    return { error: "turnstileIncomplete", saved: false, values: { turnstileSiteKey: siteKey } };
  }

  await setSiteTurnstile(ctx, parsed.data.siteId, {
    siteKey: parsed.data.siteKey,
    secret: parsed.data.secret,
    requireOnIngest: parsed.data.requireOnIngest,
  });
  revalidatePath("/sites");
  return { error: null, saved: true, values: {} };
}

export async function clearSiteTurnstileAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = z.string().min(1).safeParse(formData.get("siteId"));
  if (!parsed.success) return;
  await clearSiteTurnstile(ctx, parsed.data);
  revalidatePath("/sites");
}

export async function toggleSiteActiveAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = z.string().min(1).safeParse(formData.get("siteId"));
  if (!parsed.success) return;
  const isActive = formData.get("isActive") === "true";
  await updateSite(ctx, parsed.data, { isActive });
  revalidatePath("/sites");
}

const routingSchema = z.object({
  siteId: z.string().min(1),
  defaultStageId: z.string().optional().or(z.literal("")),
  waAccountId: z.string().optional().or(z.literal("")),
});

export async function updateSiteRoutingAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = routingSchema.safeParse({
    siteId: formData.get("siteId"),
    defaultStageId: formData.get("defaultStageId") || undefined,
    waAccountId: formData.get("waAccountId") || undefined,
  });
  if (!parsed.success) return;

  await updateSite(ctx, parsed.data.siteId, {
    defaultStageId: parsed.data.defaultStageId || undefined,
    defaultPipelineId: await pipelineForStage(ctx, parsed.data.defaultStageId || undefined),
    waAccountId: parsed.data.waAccountId || undefined,
  });
  revalidatePath("/sites");
}

// Inbound webhook lane (PLAN.md §5.2). The token is shown in full exactly
// once, inside the URL the admin pastes into Elementor/Wix/Zapier — same
// one-time-reveal rule as an API key (§5.1), since only its hash is stored.
export type HookTokenState = { token: string | null; error: string | null };

export async function issueHookTokenAction(
  _prev: HookTokenState,
  formData: FormData,
): Promise<HookTokenState> {
  const ctx = await requireTenantAdmin();
  const parsed = z.string().min(1).safeParse(formData.get("siteId"));
  if (!parsed.success) return { token: null, error: "unknown" };

  const token = await issueHookToken(ctx, parsed.data);
  revalidatePath("/sites");
  return { token, error: null };
}

export async function revokeHookTokenAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = z.string().min(1).safeParse(formData.get("siteId"));
  if (!parsed.success) return;
  await revokeHookToken(ctx, parsed.data);
  revalidatePath("/sites");
}

export async function clearHookCapturesAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = z.string().min(1).safeParse(formData.get("siteId"));
  if (!parsed.success) return;
  await clearHookCaptures(ctx, parsed.data);
  revalidatePath("/sites");
}

export type HookMappingState = { error: string | null; saved: boolean };

/** Each field arrives twice: a pick from the captured payload's paths, and a
 * free-text path for anything capture didn't offer. The picked value wins
 * when both are set — it's the one the user just chose from a list. */
function mappingPath(formData: FormData, field: string): string | undefined {
  const choice = (formData.get(`${field}Choice`) ?? "").toString().trim();
  const manual = (formData.get(`${field}Path`) ?? "").toString().trim();
  return choice || manual || undefined;
}

export async function saveHookMappingAction(
  _prev: HookMappingState,
  formData: FormData,
): Promise<HookMappingState> {
  const ctx = await requireTenantAdmin();
  const siteId = z.string().min(1).safeParse(formData.get("siteId"));
  if (!siteId.success) return { error: "unknown", saved: false };

  const phone = mappingPath(formData, "phone");
  // Phone is contact identity (§5): without it there is nothing to map onto,
  // so a mapping without a phone path is refused rather than half-saved.
  if (!phone) return { error: "phoneRequired", saved: false };

  await setSiteHookMapping(ctx, siteId.data, {
    phone,
    name: mappingPath(formData, "name"),
    email: mappingPath(formData, "email"),
    message: mappingPath(formData, "message"),
  });
  revalidatePath("/sites");
  return { error: null, saved: true };
}

// Field-label editor (PLAN.md §19.2, L3). The form posts parallel `key` /
// `label` lists plus one `prominent` value per ticked key. Tenant identity
// comes from the session only; the site id is looked up tenant-scoped, so a
// foreign id is indistinguishable from a missing one.
export type FieldLabelsFormState = { error: FieldLabelError | null; saved: boolean };

export async function saveSiteFieldLabelsAction(
  _prev: FieldLabelsFormState,
  formData: FormData,
): Promise<FieldLabelsFormState> {
  const ctx = await requireTenantAdmin();
  const siteId = z.string().min(1).safeParse(formData.get("siteId"));
  const keys = formData.getAll("key").filter((v): v is string => typeof v === "string");
  const labels = formData.getAll("label").filter((v): v is string => typeof v === "string");
  const prominent = new Set(
    formData.getAll("prominent").filter((v): v is string => typeof v === "string"),
  );
  if (!siteId.success || keys.length !== labels.length) {
    return { error: "unknown", saved: false };
  }

  const result = await saveSiteFieldSettings(
    ctx,
    siteId.data,
    keys.map((key, i) => ({ key, label: labels[i], prominent: prominent.has(key) })),
  );
  if (!result.ok) return { error: result.error, saved: false };

  revalidatePath("/sites");
  return { error: null, saved: true };
}
