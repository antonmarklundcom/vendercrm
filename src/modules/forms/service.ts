import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { forms, formSubmissions } from "@/db/schema";
import { newId } from "@/lib/ids";
import { tenantDb } from "@/modules/tenancy/db";
import { tenantContextFromJob } from "@/modules/tenancy/context";
import { getTenantBySlug } from "@/modules/tenancy/service";
import {
  upsertContactByPhoneOrEmail,
  addTagToContact,
} from "@/modules/crm/contacts";
import { createDeal } from "@/modules/crm/deals";
import { addActivity } from "@/modules/crm/activities";
import { emit } from "@/lib/events";
import type { TenantContext } from "@/modules/tenancy/types";

export const fieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "phone", "email", "select", "textarea"]),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
});
export type FormField = z.infer<typeof fieldSchema>;

export const settingsSchema = z.object({
  redirectUrl: z.string().url().optional(),
  targetPipelineId: z.string().optional(),
  targetStageId: z.string().optional(),
  defaultTagIds: z.array(z.string()).optional(),
});
export type FormSettings = z.infer<typeof settingsSchema>;

// --- Authoring (tenant-scoped) ----------------------------------------------

export async function listForms(ctx: TenantContext) {
  return tenantDb(ctx).select(forms).orderBy(desc(forms.createdAt));
}

export async function getForm(ctx: TenantContext, formId: string) {
  const [row] = await tenantDb(ctx).select(forms, eq(forms.id, formId));
  return row ?? null;
}

export async function createForm(
  ctx: TenantContext,
  input: {
    name: string;
    slug: string;
    fields: FormField[];
    settings?: FormSettings;
  },
): Promise<string> {
  const id = newId();
  await tenantDb(ctx).insert(forms, {
    id,
    name: input.name,
    slug: input.slug.toLowerCase(),
    fields: input.fields,
    settings: input.settings ?? null,
  });
  return id;
}

export async function updateForm(
  ctx: TenantContext,
  formId: string,
  input: {
    name?: string;
    fields?: FormField[];
    settings?: FormSettings;
    isActive?: boolean;
  },
): Promise<void> {
  const set: Record<string, unknown> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.fields !== undefined) set.fields = input.fields;
  if (input.settings !== undefined) set.settings = input.settings;
  if (input.isActive !== undefined) set.isActive = input.isActive;
  if (Object.keys(set).length === 0) return;
  await tenantDb(ctx).update(forms, set, eq(forms.id, formId));
}

// --- Public rendering + submission ------------------------------------------

export type PublicForm = {
  tenantId: string;
  tenantName: string;
  formId: string;
  name: string;
  fields: FormField[];
  settings: FormSettings | null;
};

// Unauthenticated: resolve tenant by slug, then the active form by slug within
// that tenant. Returns null for missing/inactive so the route can 404.
export async function resolvePublicForm(
  tenantSlug: string,
  formSlug: string,
): Promise<PublicForm | null> {
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant || tenant.status === "suspended") return null;

  const ctx = tenantContextFromJob({ tenantId: tenant.id });
  const [form] = await tenantDb(ctx).select(
    forms,
    and(eq(forms.slug, formSlug.toLowerCase()), eq(forms.isActive, true))!,
  );
  if (!form) return null;

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    formId: form.id,
    name: form.name,
    fields: form.fields as FormField[],
    settings: (form.settings as FormSettings | null) ?? null,
  };
}

// Handle a public submission: upsert the contact by phone/email, apply default
// tags, optionally open a deal in the configured stage, record the submission +
// a timeline activity, and emit `form.submitted` (PLAN.md §5). Runs under a
// system tenant context reconstructed from the resolved form's tenant.
export async function submitPublicForm(input: {
  tenantSlug: string;
  formSlug: string;
  data: Record<string, string>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ ok: boolean; redirectUrl?: string }> {
  const form = await resolvePublicForm(input.tenantSlug, input.formSlug);
  if (!form) return { ok: false };

  const ctx = tenantContextFromJob({ tenantId: form.tenantId });
  const fields = form.fields;

  // Pull identity fields by their declared type.
  const phoneKey = fields.find((f) => f.type === "phone")?.key;
  const emailKey = fields.find((f) => f.type === "email")?.key;
  const nameKey =
    fields.find((f) => f.key === "name" || f.label.toLowerCase().includes("nombre"))
      ?.key ?? fields.find((f) => f.type === "text")?.key;

  const phone = phoneKey ? input.data[phoneKey] : undefined;
  const email = emailKey ? input.data[emailKey] : undefined;
  const name = (nameKey ? input.data[nameKey] : undefined) || "Sin nombre";

  const { contactId } = await upsertContactByPhoneOrEmail(ctx, {
    name,
    phone: phone ?? null,
    email: email ?? null,
    source: `form:${form.name}`,
  });

  const settings = form.settings;
  for (const tagId of settings?.defaultTagIds ?? []) {
    await addTagToContact(ctx, contactId, tagId);
  }

  let dealId: string | null = null;
  if (settings?.targetPipelineId && settings?.targetStageId) {
    dealId = await createDeal(ctx, {
      contactId,
      pipelineId: settings.targetPipelineId,
      stageId: settings.targetStageId,
      title: name,
    });
  }

  const submissionId = newId();
  await tenantDb(ctx).insert(formSubmissions, {
    id: submissionId,
    formId: form.formId,
    contactId,
    data: input.data,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  await addActivity(ctx, {
    contactId,
    type: "form_submission",
    payload: { formName: form.name, data: input.data },
    userId: null,
  });

  await emit("form.submitted", {
    tenantId: form.tenantId,
    formId: form.formId,
    submissionId,
    contactId,
    dealId,
  });

  return { ok: true, redirectUrl: settings?.redirectUrl };
}
