import { eq } from "drizzle-orm";
import { forms } from "@/db/schema";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { getTenantBySlug } from "@/modules/tenancy/tenants";
import { tenantDb } from "@/modules/tenancy/db";
import { normalizePhone, updateContact } from "@/modules/crm/contacts";
import { listCustomFieldDefinitions, coerceCustomFieldValue } from "@/modules/crm/custom-fields";
import { recordLeadSubmission } from "@/modules/leads/submissions";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { getSite } from "@/modules/sites/sites";
import { siteTurnstileSecret, siteTurnstileSiteKey } from "@/modules/sites/settings";
import { DEFAULT_COUNTRY } from "@/lib/phone";
import type { TenantSettings } from "@/modules/tenancy/settings";
import type { FormSettings } from "./forms";
import type { FormField } from "./field-definitions";
import { validateSubmissionData } from "./field-definitions";

// Thrown messages are stable codes, not copy (PLAN.md §13 H5 #4): a
// literal Spanish sentence here is a string the user might see in an
// unknown language, and one nothing can translate. The UI turns these into
// the reader's own language — an action's form state where there is a form,
// the route group's error boundary where there isn't.

// Public form submission (PLAN.md §5). Unauthenticated by nature — the
// tenant is resolved from the URL slug, not from user input, then a system
// TenantContext is built from that resolved id (never a client-supplied
// tenantId).
//
// The CRM-side effects (contact upsert, deal, timeline, event) are shared
// with the ingest API via modules/leads (§5.1); this file only resolves the
// form and maps its fields.

/** Resolves the public form for rendering `/f/[tenantSlug]/[formSlug]`. */
export async function getPublicForm(tenantSlug: string, formSlug: string) {
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return null;

  const ctx = await buildSystemTenantContext(tenant.id);
  if (!ctx) return null;

  const [form] = await tenantDb(ctx).select(forms, eq(forms.slug, formSlug));
  if (!form || !form.isActive) return null;

  // Turnstile config, if this form is pointed at a site that has it (§5.2).
  // Only the public site key is returned here — the page renders it; the
  // secret is read separately, inside submitForm, and never leaves the
  // server.
  const turnstileSiteId = (form.settings as FormSettings).turnstileSiteId;
  const turnstileSite = turnstileSiteId ? await getSite(ctx, turnstileSiteId) : null;

  return {
    tenant,
    form,
    turnstileSiteKey: turnstileSite ? siteTurnstileSiteKey(turnstileSite) : null,
  };
}

export type SubmitFormInput = {
  data: Record<string, string>;
  ipAddress?: string;
  userAgent?: string;
  /** Widget token, when the form's linked site has Turnstile on (§5.2). */
  turnstileToken?: string;
};

// Per-IP fixed-window limit, form-scoped so one spammy form can't exhaust a
// shared visitor's budget on another (see lib/rate-limit for the shared
// implementation and its documented limitation).
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

export async function submitForm(
  tenantSlug: string,
  formSlug: string,
  input: SubmitFormInput,
) {
  const resolved = await getPublicForm(tenantSlug, formSlug);
  if (!resolved) throw new Error("form_not_found");
  const { tenant, form } = resolved;

  const rateKey = `form:${form.id}:${input.ipAddress ?? "unknown"}`;
  if ((await checkRateLimit(rateKey, RATE_LIMIT, RATE_WINDOW_MS)).limited) {
    throw new Error("form_rate_limited");
  }

  const ctx = await buildSystemTenantContext(tenant.id);
  if (!ctx) throw new Error("form_not_found");

  // Turnstile (§5.2) sits next to the honeypot: a form whose linked site has
  // no secret configured is unchanged, and one that does must pass before
  // any contact is written. The message is Spanish because this throw is
  // rendered to the visitor, the same way the rate-limit one above is.
  const turnstileSiteId = (form.settings as FormSettings).turnstileSiteId;
  const turnstileSite = turnstileSiteId ? await getSite(ctx, turnstileSiteId) : null;
  const turnstileSecret = turnstileSite ? siteTurnstileSecret(turnstileSite) : null;
  if (turnstileSecret) {
    const verdict = await verifyTurnstileToken({
      secret: turnstileSecret,
      token: input.turnstileToken,
      remoteIp: input.ipAddress,
    });
    if (!verdict.ok) {
      throw new Error("turnstile_failed");
    }
  }

  const fields = form.fields as FormField[];
  const valueOfType = (type: string) => {
    const field = fields.find((f) => f.type === type);
    return field ? input.data[field.key] : undefined;
  };

  const phone = valueOfType("phone");
  if (!phone) throw new Error("phone_required");

  // Re-validates required/select constraints server-side (§5) — the public
  // page enforces the same rules via `required`/native <select>, but that's
  // a courtesy, not a boundary.
  validateSubmissionData(fields, input.data);

  const nameField = fields.find((f) => f.key === "name" || f.key === "nombre");
  const name = nameField ? input.data[nameField.key] : undefined;

  const settings = form.settings as FormSettings;
  const tenantSettings = (tenant.settings ?? {}) as TenantSettings;

  const result = await recordLeadSubmission(ctx, {
    formId: form.id,
    phone: normalizePhone(phone, tenantSettings.defaultCountry ?? DEFAULT_COUNTRY),
    name,
    email: valueOfType("email"),
    message: valueOfType("textarea"),
    source: `form:${form.slug}`,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    payload: input.data,
    defaults: {
      pipelineId: settings.targetPipelineId,
      stageId: settings.targetStageId,
      tagIds: settings.defaultTagIds ?? [],
      dealTitle: `${form.name} — ${name || phone}`,
    },
  });

  // Fields mapped to a P5 custom field (§17.3 "P15/P17" P17 half) land in
  // `contacts.custom` through the same `updateContact` path the contact edit
  // form uses — merged, not replaced, so this never clobbers a value the
  // contact already had from elsewhere.
  const mappedFields = fields.filter((f) => f.mapTo);
  if (mappedFields.length > 0) {
    const definitions = await listCustomFieldDefinitions(ctx);
    const definitionsByKey = new Map(definitions.map((d) => [d.key, d]));
    const custom: Record<string, string | number | null> = {};
    for (const field of mappedFields) {
      const raw = input.data[field.key];
      const definition = field.mapTo ? definitionsByKey.get(field.mapTo) : undefined;
      if (!raw || !definition) continue;
      const coerced = coerceCustomFieldValue(definition, raw);
      if (coerced !== null) custom[definition.key] = coerced;
    }
    if (Object.keys(custom).length > 0) {
      await updateContact(ctx, result.contactId, { custom });
    }
  }

  // WhatsApp marketing consent (§17.3 "P15/P17" P17 half): a ticked
  // `consent_whatsapp` checkbox would stamp `contacts.wa_marketing_consent_at`
  // here, but that column doesn't exist on `main` yet (P10, lane 1, not
  // merged when this phase ran) — logged in KNOWN-ISSUES.md, per the phase's
  // documented fallback. The checkbox field type itself still ships.

  return {
    contactId: result.contactId,
    submissionId: result.submissionId,
    redirectUrl: settings.redirectUrl,
  };
}
