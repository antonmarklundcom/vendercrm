"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantContext } from "@/modules/tenancy/context";
import { assertWritable } from "@/modules/tenancy/access";
import {
  createContact,
  createTag,
  addTagToContact,
} from "@/modules/crm/contacts";
import { addActivity } from "@/modules/crm/activities";
import { createDeal, moveDeal, assignDeal } from "@/modules/crm/deals";
import { createForm, updateForm, fieldSchema } from "@/modules/forms/service";
import { updateTenantSettings } from "@/modules/tenancy/service";

// Every write action resolves the tenant context itself (never trusts client
// tenant ids) and refuses writes for a past-due tenant.
async function writableCtx() {
  const ctx = await requireTenantContext();
  await assertWritable(ctx.tenantId);
  return ctx;
}

const contactSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  notes: z.string().optional(),
  source: z.string().optional(),
});

export async function createContactAction(formData: FormData) {
  const ctx = await writableCtx();
  const input = contactSchema.parse({
    name: formData.get("name"),
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || undefined,
    notes: formData.get("notes") || undefined,
    source: formData.get("source") || undefined,
  });
  await createContact(ctx, {
    ...input,
    email: input.email || null,
  });
  revalidatePath("/app/contacts");
}

export async function addNoteAction(contactId: string, body: string) {
  const ctx = await writableCtx();
  await addActivity(ctx, {
    contactId,
    type: "note",
    payload: { body },
  });
  revalidatePath(`/app/contacts/${contactId}`);
}

const dealSchema = z.object({
  contactId: z.string().min(1),
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  title: z.string().min(1),
  value: z.coerce.number().int().nonnegative().optional(),
});

export async function createDealAction(formData: FormData) {
  const ctx = await writableCtx();
  const input = dealSchema.parse({
    contactId: formData.get("contactId"),
    pipelineId: formData.get("pipelineId"),
    stageId: formData.get("stageId"),
    title: formData.get("title"),
    value: formData.get("value") || undefined,
  });
  await createDeal(ctx, input);
  revalidatePath("/app/pipeline");
}

export async function moveDealAction(dealId: string, toStageId: string) {
  const ctx = await writableCtx();
  await moveDeal(ctx, dealId, toStageId);
  revalidatePath("/app/pipeline");
}

export async function assignDealAction(
  dealId: string,
  assignedUserId: string | null,
) {
  const ctx = await writableCtx();
  await assignDeal(ctx, dealId, assignedUserId);
  revalidatePath("/app/pipeline");
}

export async function createTagAction(name: string) {
  const ctx = await writableCtx();
  return createTag(ctx, { name });
}

export async function addTagAction(contactId: string, tagId: string) {
  const ctx = await writableCtx();
  await addTagToContact(ctx, contactId, tagId);
  revalidatePath(`/app/contacts/${contactId}`);
}

const createFormSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Solo minúsculas, números y guiones"),
});

export async function createFormAction(formData: FormData) {
  const ctx = await writableCtx();
  const base = createFormSchema.parse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  // Sensible default lead form: name, phone, email.
  await createForm(ctx, {
    ...base,
    fields: [
      fieldSchema.parse({ key: "name", label: "Nombre", type: "text", required: true }),
      fieldSchema.parse({ key: "phone", label: "Teléfono", type: "phone", required: true }),
      fieldSchema.parse({ key: "email", label: "Correo", type: "email", required: false }),
    ],
  });
  revalidatePath("/app/forms");
}

export async function setFormActiveAction(formId: string, isActive: boolean) {
  const ctx = await writableCtx();
  await updateForm(ctx, formId, { isActive });
  revalidatePath("/app/forms");
}

const settingsSchema = z.object({
  timezone: z.string().min(1),
  brandColor: z.string().optional(),
  logoUrl: z.string().url().optional().or(z.literal("")),
  businessHoursStart: z.string().optional(),
  businessHoursEnd: z.string().optional(),
});

export async function updateSettingsAction(formData: FormData) {
  const ctx = await writableCtx();
  const input = settingsSchema.parse({
    timezone: formData.get("timezone"),
    brandColor: formData.get("brandColor") || undefined,
    logoUrl: formData.get("logoUrl") || undefined,
    businessHoursStart: formData.get("businessHoursStart") || undefined,
    businessHoursEnd: formData.get("businessHoursEnd") || undefined,
  });
  await updateTenantSettings(ctx, {
    timezone: input.timezone,
    settings: {
      brandColor: input.brandColor,
      logoUrl: input.logoUrl || undefined,
      businessHoursStart: input.businessHoursStart,
      businessHoursEnd: input.businessHoursEnd,
    },
  });
  revalidatePath("/app/settings");
}
