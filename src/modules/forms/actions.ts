"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { tenantDb } from "@/modules/tenancy/db";
import { getTenantContext } from "@/modules/tenancy/context";
import { forms } from "@/db/schema/forms";
import type { FormField, FormSettings } from "@/db/schema/forms";
import { slugify } from "@/lib/slug";

export async function createForm(input: {
  name: string;
  fields: FormField[];
  settings?: FormSettings;
}): Promise<void> {
  const ctx = await getTenantContext();
  const scoped = tenantDb(ctx);

  const base = slugify(input.name, "form");
  let slug = base;
  let suffix = 1;
  while (await scoped.findFirst(forms, eq(forms.slug, slug))) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }

  const [inserted] = await scoped
    .insert(forms, {
      name: input.name,
      slug,
      fields: input.fields,
      settings: input.settings ?? {},
    })
    .$returningId();

  revalidatePath("/forms");
  redirect(`/forms/${inserted.id}`);
}

export async function updateFormFields(id: string, fields: FormField[]): Promise<void> {
  const ctx = await getTenantContext();
  await tenantDb(ctx).update(forms, { fields }, eq(forms.id, id));
  revalidatePath(`/forms/${id}`);
}

export async function setFormActive(id: string, isActive: boolean): Promise<void> {
  const ctx = await getTenantContext();
  await tenantDb(ctx).update(forms, { isActive }, eq(forms.id, id));
  revalidatePath(`/forms/${id}`);
}
