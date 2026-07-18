import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tenants } from "@/db/schema/tenancy";
import { contacts, deals, activities } from "@/db/schema/crm";
import { forms, formSubmissions } from "@/db/schema/forms";
import { normalizePhonePY } from "@/lib/phone";
import { crmEvents } from "@/modules/crm/events";
import { formsEvents } from "./events";

export async function getPublicForm(tenantSlug: string, formSlug: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  if (!tenant) return null;

  const [form] = await db
    .select()
    .from(forms)
    .where(and(eq(forms.tenantId, tenant.id), eq(forms.slug, formSlug), eq(forms.isActive, true)))
    .limit(1);

  if (!form) return null;

  return { tenant, form };
}

export type PublicSubmitResult = { ok: true } | { ok: false; error: string };

export async function submitPublicForm(
  tenantSlug: string,
  formSlug: string,
  data: Record<string, string>,
  meta: { ipAddress?: string; userAgent?: string },
): Promise<PublicSubmitResult> {
  const resolved = await getPublicForm(tenantSlug, formSlug);
  if (!resolved) return { ok: false, error: "Formulario no encontrado" };

  const { tenant, form } = resolved;

  const phoneField = form.fields.find((f) => f.type === "phone");
  const rawPhone = phoneField ? data[phoneField.key] : undefined;
  if (!rawPhone) return { ok: false, error: "Falta el teléfono" };

  const phone = normalizePhonePY(rawPhone);
  const emailField = form.fields.find((f) => f.type === "email");
  const nameField = form.fields.find((f) => f.key === "name") ?? form.fields[0];

  const [existingContact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenant.id), eq(contacts.phone, phone)))
    .limit(1);

  let contactId: string;
  let isNewContact = false;

  if (existingContact) {
    contactId = existingContact.id;
  } else {
    isNewContact = true;
    const [inserted] = await db
      .insert(contacts)
      .values({
        tenantId: tenant.id,
        name: (nameField && data[nameField.key]) || phone,
        phone,
        email: emailField ? data[emailField.key] || null : null,
        source: "form",
      })
      .$returningId();
    contactId = inserted.id;
  }

  const [submission] = await db
    .insert(formSubmissions)
    .values({
      tenantId: tenant.id,
      formId: form.id,
      contactId,
      data,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })
    .$returningId();

  await db.insert(activities).values({
    tenantId: tenant.id,
    contactId,
    type: "form_submission",
    payload: { formId: form.id, formName: form.name },
  });

  if (form.settings.targetPipelineId && form.settings.targetStageId) {
    await db.insert(deals).values({
      tenantId: tenant.id,
      contactId,
      pipelineId: form.settings.targetPipelineId,
      stageId: form.settings.targetStageId,
      title: `${form.name} — ${(nameField && data[nameField.key]) || phone}`,
    });
  }

  await formsEvents.emit("form.submitted", {
    tenantId: tenant.id,
    formId: form.id,
    contactId,
    submissionId: submission.id,
  });
  if (isNewContact) {
    await crmEvents.emit("contact.created", { tenantId: tenant.id, contactId });
  }

  return { ok: true };
}
