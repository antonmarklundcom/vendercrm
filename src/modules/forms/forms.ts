import { eq } from "drizzle-orm";
import { forms, leadSubmissions } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import type { FormField } from "./field-definitions";

// Tenant-side form builder CRUD (PLAN.md §4 "forms"). Public submission
// (unauthenticated) lives in ./submissions.ts. Field-list validation (types,
// `mapTo`, the "phone stays mandatory" rule, key immutability) lives in
// ./field-definitions.ts — this module only stores whatever it's handed.

export type { FormField, FormFieldType } from "./field-definitions";

export type FormSettings = {
  redirectUrl?: string;
  targetPipelineId?: string;
  targetStageId?: string;
  defaultTagIds?: string[];
  /**
   * Which site's Cloudflare Turnstile credentials this hosted form uses
   * (PLAN.md §5.2). Turnstile is configured per *site*, and a hosted form
   * has no site of its own, so the tenant points the form at one. Unset —
   * the state every form created before §5.2 is in — means honeypot only,
   * exactly as before.
   *
   * Deliberately *not* the submission's `site_id`: attribution still says
   * this lead came through a hosted form, not through that site's own
   * backend. This link is credentials, not provenance.
   */
  turnstileSiteId?: string;
};

export type CreateFormInput = {
  name: string;
  slug: string;
  fields: FormField[];
  settings?: FormSettings;
};

export async function createForm(ctx: TenantContext, input: CreateFormInput) {
  const id = newId();
  await tenantDb(ctx)
    .insert(forms)
    .values({
      id,
      name: input.name,
      slug: input.slug,
      fields: input.fields,
      settings: input.settings ?? {},
    });
  return getForm(ctx, id);
}

export type UpdateFormInput = Partial<CreateFormInput> & { isActive?: boolean };

export async function updateForm(ctx: TenantContext, id: string, input: UpdateFormInput) {
  await tenantDb(ctx).update(forms).set(input).where(eq(forms.id, id));
  return getForm(ctx, id);
}

export async function getForm(ctx: TenantContext, id: string) {
  const [row] = await tenantDb(ctx).select(forms, eq(forms.id, id));
  return row ?? null;
}

export function listForms(ctx: TenantContext) {
  return tenantDb(ctx)
    .select(forms)
    .then((rows) => rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
}

/** Whether this form has ever received a submission — the editor uses this
 *  to decide whether a field's `key` is still renamable (see
 *  `field-definitions.ts`'s `assertKeysNotRenamed`). */
export async function hasFormSubmissions(ctx: TenantContext, formId: string): Promise<boolean> {
  const rows = await tenantDb(ctx)
    .select(leadSubmissions, eq(leadSubmissions.formId, formId))
    .then((r) => r.slice(0, 1));
  return rows.length > 0;
}
