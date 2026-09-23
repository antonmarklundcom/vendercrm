"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperadminContext, buildSystemTenantContext } from "@/modules/tenancy/context";
import {
  createTenant,
  suspendTenant,
  activateTenant,
  getTenant,
  getTenantBySlug,
} from "@/modules/tenancy/tenants";
import { deleteTenant } from "@/modules/tenancy/purge";
import { seedDefaultPipeline } from "@/modules/crm/pipelines";
import { uniqueSlug } from "@/lib/slug";

const createTenantSchema = z.object({
  name: z.string().min(1).max(200),
  // Optional: the form fills it in as you type the name, and an operator who
  // clears it means "derive one" rather than "fail". A slug that *is* given
  // still has to be a slug.
  slug: z
    .string()
    .max(100)
    .regex(/^[a-z0-9-]*$/)
    .optional(),
});

// useActionState-shaped (PLAN.md §10 1R #6): a missing name or a bad/taken
// slug comes back inline instead of throwing to Next's error page.
export type TenantField = "name" | "slug";

export type CreateTenantFormState = {
  error: string | null;
  field: TenantField | null;
  values: Record<string, string>;
};

const TENANT_FIELD_ERRORS: Record<TenantField, string> = {
  name: "nameRequired",
  slug: "slugInvalid",
};

export async function createTenantAction(
  _prevState: CreateTenantFormState,
  formData: FormData,
): Promise<CreateTenantFormState> {
  const ctx = await requireSuperadminContext();
  const values = Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  const parsed = createTenantSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (typeof field === "string" && field in TENANT_FIELD_ERRORS) {
      const key = field as TenantField;
      return { error: TENANT_FIELD_ERRORS[key], field: key, values };
    }
    return { error: "unknown", field: null, values };
  }

  const isTaken = async (candidate: string) => (await getTenantBySlug(candidate)) !== null;

  let slug: string;
  if (parsed.data.slug) {
    // A slug typed by hand is taken at face value and refused if it collides
    // — silently renaming somebody's deliberate choice to "-2" is worse than
    // telling them.
    if (await isTaken(parsed.data.slug)) {
      return { error: "slugTaken", field: "slug", values };
    }
    slug = parsed.data.slug;
  } else {
    try {
      slug = await uniqueSlug(parsed.data.name, isTaken);
    } catch {
      return { error: "slugTaken", field: "slug", values };
    }
  }

  let tenant;
  try {
    tenant = await createTenant(ctx, { name: parsed.data.name, slug });
  } catch {
    return { error: "slugTaken", field: "slug", values };
  }

  if (!tenant) return { error: "unknown", field: null, values };
  const tenantCtx = await buildSystemTenantContext(tenant.id);
  if (tenantCtx) await seedDefaultPipeline(tenantCtx);
  revalidatePath("/tenants");
  // Straight to the new business: its next step (a site and its API key,
  // people) lives on that page, not on the list.
  redirect(`/tenants/${tenant.id}`);
}

export async function suspendTenantAction(formData: FormData) {
  const ctx = await requireSuperadminContext();
  const parsed = z.string().min(1).safeParse(formData.get("tenantId"));
  if (!parsed.success) return;
  await suspendTenant(ctx, parsed.data);
  // The list and the business page both show the status.
  revalidatePath("/tenants", "layout");
}

export async function activateTenantAction(formData: FormData) {
  const ctx = await requireSuperadminContext();
  const parsed = z.string().min(1).safeParse(formData.get("tenantId"));
  if (!parsed.success) return;
  await activateTenant(ctx, parsed.data);
  // The list and the business page both show the status.
  revalidatePath("/tenants", "layout");
}

export type DeleteTenantState = { error: string | null };

/**
 * Deletes a business and everything under it (src/modules/tenancy/purge.ts).
 * The form makes the operator type the business's slug: suspending is one
 * click because it can be undone, and this cannot.
 */
export async function deleteTenantAction(
  _prev: DeleteTenantState,
  formData: FormData,
): Promise<DeleteTenantState> {
  const ctx = await requireSuperadminContext();
  const parsed = z
    .object({ tenantId: z.string().min(1).max(26), confirm: z.string() })
    .safeParse({ tenantId: formData.get("tenantId"), confirm: formData.get("confirm") });
  if (!parsed.success) return { error: "unknown" };

  const tenant = await getTenant(parsed.data.tenantId);
  if (!tenant) return { error: "unknown" };
  if (parsed.data.confirm.trim() !== tenant.slug) return { error: "confirmMismatch" };

  try {
    await deleteTenant(ctx, tenant.id);
  } catch {
    return { error: "unknown" };
  }

  revalidatePath("/tenants", "layout");
  redirect("/tenants");
}
