"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenantAdmin, requireTenantContext } from "@/modules/tenancy/context";
import {
  CONTACT_FIELD_KEYS,
  mergeContacts,
  MergeError,
  type FieldChoices,
} from "@/modules/crm/merge";
import { setContactCompany } from "@/modules/crm/companies";

// Contact merge (PLAN.md §15.5 J11c, §17.2 P16) and the company picker on
// the contact's own "datos" tab. Both are admin-only, destructive/
// structural changes — same posture as delete (§13 H1).

export type MergeFormState = { error: string | null };

const mergeSchema = z.object({
  winnerId: z.string().min(1),
  loserId: z.string().min(1),
});

export async function mergeContactAction(
  _prevState: MergeFormState,
  formData: FormData,
): Promise<MergeFormState> {
  const ctx = await requireTenantAdmin();
  const parsed = mergeSchema.safeParse({
    winnerId: formData.get("winnerId"),
    loserId: formData.get("loserId"),
  });
  if (!parsed.success) return { error: "invalid" };

  const fieldChoices: FieldChoices = {};
  for (const key of CONTACT_FIELD_KEYS) {
    const value = formData.get(`field_${key}`);
    if (value === "winner" || value === "loser") fieldChoices[key] = value;
  }

  try {
    await mergeContacts(ctx, parsed.data.winnerId, parsed.data.loserId, fieldChoices);
  } catch (err) {
    if (err instanceof MergeError) return { error: err.code };
    throw err;
  }

  redirect(`/contacts/${parsed.data.winnerId}?tab=datos`);
}

export async function setContactCompanyAction(contactId: string, formData: FormData) {
  const ctx = await requireTenantContext();
  const companyId = String(formData.get("companyId") ?? "").trim();
  await setContactCompany(ctx, contactId, companyId || null);
  revalidatePath(`/contacts/${contactId}`);
}
