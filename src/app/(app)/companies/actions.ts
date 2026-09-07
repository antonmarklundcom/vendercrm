"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantAdmin, requireTenantContext } from "@/modules/tenancy/context";
import {
  createCompany,
  deleteCompany,
  updateCompany,
  CompanyNameTakenError,
} from "@/modules/crm/companies";

// Companies (PLAN.md §15.5 J11c, §17.2/§17.3 P16). Create/edit are any
// tenant member's (admin+agent, same posture as contacts/deals); delete is
// admin-only and only while the company has no contacts (§10 1S pattern).

const companySchema = z.object({
  name: z.string().min(1).max(200),
  ruc: z.string().max(30).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().max(320).optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
});

export type CompanyFormState = { error: string | null };

function parseCompanyForm(formData: FormData) {
  return companySchema.parse({
    name: formData.get("name"),
    ruc: formData.get("ruc") || undefined,
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || undefined,
    address: formData.get("address") || undefined,
    notes: formData.get("notes") || undefined,
  });
}

export async function createCompanyAction(
  _prevState: CompanyFormState,
  formData: FormData,
): Promise<CompanyFormState> {
  const ctx = await requireTenantContext();
  let parsed;
  try {
    parsed = parseCompanyForm(formData);
  } catch {
    return { error: "invalid" };
  }

  let company;
  try {
    company = await createCompany(ctx, parsed);
  } catch (err) {
    if (err instanceof CompanyNameTakenError) return { error: "nameTaken" };
    throw err;
  }

  redirect(`/companies/${company.id}`);
}

export async function updateCompanyAction(
  companyId: string,
  _prevState: CompanyFormState,
  formData: FormData,
): Promise<CompanyFormState> {
  const ctx = await requireTenantContext();
  let parsed;
  try {
    parsed = parseCompanyForm(formData);
  } catch {
    return { error: "invalid" };
  }

  try {
    await updateCompany(ctx, companyId, parsed);
  } catch (err) {
    if (err instanceof CompanyNameTakenError) return { error: "nameTaken" };
    throw err;
  }

  revalidatePath(`/companies/${companyId}`);
  return { error: null };
}

export async function deleteCompanyAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const companyId = String(formData.get("companyId") ?? "");
  if (!companyId) return;

  try {
    await deleteCompany(ctx, companyId);
  } catch {
    redirect(`/companies/${companyId}?deleteError=1`);
  }

  redirect("/companies");
}
