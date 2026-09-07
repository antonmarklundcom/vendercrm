"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTenantAdmin } from "@/modules/tenancy/context";
import { createForm, getForm, updateForm } from "@/modules/forms/forms";
import type { FormField, FormSettings } from "@/modules/forms/forms";

// Lead-capture forms are tenant configuration (§3.2 reserves it for `admin`):
// a form defines a public endpoint on the tenant's slug and decides which
// pipeline strangers' submissions land in. Both actions require admin; the
// page and nav entry are hidden for agents as defense in depth.

// Standard field set a new form starts with — nombre/teléfono/correo covers
// the lead-capture case this product is sold on, and submissions.ts already
// resolves contacts by any "phone" typed field, not a hardcoded key. The
// tenant can then add/remove/reorder/map fields in the `/forms/[id]` editor
// (PLAN.md §17.3 "P15/P17" P17 half).
const STANDARD_FIELDS: FormField[] = [
  { key: "nombre", label: "Nombre", type: "text", required: true },
  { key: "phone", label: "Teléfono", type: "phone", required: true },
  { key: "email", label: "Correo", type: "email", required: false },
];

const createFormSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/),
  targetPipelineId: z.string().optional().or(z.literal("")),
  targetStageId: z.string().optional().or(z.literal("")),
  turnstileSiteId: z.string().optional().or(z.literal("")),
});

// useActionState-shaped (PLAN.md §10 1R #6): a missing name or a slug with
// spaces/uppercase comes back inline instead of throwing to Next's error
// page. Named FormCreateField, not FormField, to avoid clashing with the
// lead-capture field type already exported from @/modules/forms/forms.
export type FormCreateField = "name" | "slug";

export type FormFormState = {
  error: string | null;
  field: FormCreateField | null;
  values: Record<string, string>;
};

const FORM_FIELD_ERRORS: Record<FormCreateField, string> = {
  name: "nameRequired",
  slug: "slugInvalid",
};

export async function createFormAction(
  _prevState: FormFormState,
  formData: FormData,
): Promise<FormFormState> {
  const ctx = await requireTenantAdmin();
  const values = Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  const parsed = createFormSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    targetPipelineId: formData.get("targetPipelineId") || undefined,
    targetStageId: formData.get("targetStageId") || undefined,
    turnstileSiteId: formData.get("turnstileSiteId") || undefined,
  });

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (typeof field === "string" && field in FORM_FIELD_ERRORS) {
      const key = field as FormCreateField;
      return { error: FORM_FIELD_ERRORS[key], field: key, values };
    }
    return { error: "unknown", field: null, values };
  }

  try {
    await createForm(ctx, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      fields: STANDARD_FIELDS,
      settings: {
        targetPipelineId: parsed.data.targetPipelineId || undefined,
        targetStageId: parsed.data.targetStageId || undefined,
        // Which site's Turnstile credentials this hosted form borrows
        // (PLAN.md §5.2). Empty = honeypot only, as before.
        turnstileSiteId: parsed.data.turnstileSiteId || undefined,
      },
    });
  } catch {
    return { error: "unknown", field: null, values };
  }

  revalidatePath("/forms");
  return { error: null, field: null, values: {} };
}

// Points an existing form at a site's Turnstile credentials — or unlinks it
// (PLAN.md §5.2). Reachable only from a hidden form id plus a select, so it
// follows the safeParse + silent-return shape (§10 1R #6) rather than
// carrying form state: there is no user-typed field for an error to sit under.
const formTurnstileSchema = z.object({
  formId: z.string().min(1),
  turnstileSiteId: z.string().optional().or(z.literal("")),
});

export async function updateFormTurnstileAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = formTurnstileSchema.safeParse({
    formId: formData.get("formId"),
    turnstileSiteId: formData.get("turnstileSiteId") || undefined,
  });
  if (!parsed.success) return;

  const form = await getForm(ctx, parsed.data.formId);
  if (!form) return;

  const settings = (form.settings ?? {}) as FormSettings;
  await updateForm(ctx, form.id, {
    settings: { ...settings, turnstileSiteId: parsed.data.turnstileSiteId || undefined },
  });
  revalidatePath("/forms");
}
