"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTenantOperator } from "@/modules/tenancy/context";
import { createForm } from "@/modules/forms/forms";
import type { FormField } from "@/modules/forms/forms";

// Standard field set (PLAN.md §4 "forms" allows text/phone/email/select/
// textarea; the tenant-side field-order/type editor is left for a later
// pass — nombre/teléfono/correo covers the lead-capture case this product
// is sold on, and submissions.ts already resolves contacts by any "phone"
// typed field, not a hardcoded key).
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
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with dashes"),
  targetPipelineId: z.string().optional().or(z.literal("")),
  targetStageId: z.string().optional().or(z.literal("")),
});

export async function createFormAction(formData: FormData) {
  const ctx = await requireTenantOperator();
  const input = createFormSchema.parse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    targetPipelineId: formData.get("targetPipelineId") || undefined,
    targetStageId: formData.get("targetStageId") || undefined,
  });

  await createForm(ctx, {
    name: input.name,
    slug: input.slug,
    fields: STANDARD_FIELDS,
    settings: {
      targetPipelineId: input.targetPipelineId || undefined,
      targetStageId: input.targetStageId || undefined,
    },
  });
  revalidatePath("/forms");
}
