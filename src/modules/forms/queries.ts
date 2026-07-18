import { eq } from "drizzle-orm";
import { tenantDb } from "@/modules/tenancy/db";
import { formSubmissions, forms } from "@/db/schema/forms";
import type { TenantContext } from "@/modules/tenancy/context";

export async function listForms(ctx: TenantContext) {
  return tenantDb(ctx).findMany(forms);
}

export async function getFormById(ctx: TenantContext, id: string) {
  return tenantDb(ctx).findFirst(forms, eq(forms.id, id));
}

export async function getFormSubmissions(ctx: TenantContext, formId: string) {
  const rows = await tenantDb(ctx).findMany(
    formSubmissions,
    eq(formSubmissions.formId, formId),
  );
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
