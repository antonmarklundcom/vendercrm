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
import { getUserByEmail } from "@/modules/tenancy/users";
import { addMembership, MembershipError } from "@/modules/tenancy/memberships";
import { writeAuditLog } from "@/modules/tenancy/audit";
import { seedDefaultPipeline } from "@/modules/crm/pipelines";
import { uniqueSlug } from "@/lib/slug";

// A batch action never touches more rows than a click could plausibly mean
// to select on one page of the list; it is a backstop against a malformed
// request, not a real-world limit (the list itself paginates at 50).
const MAX_BATCH = 200;
const idsSchema = z.array(z.string().min(1).max(26)).min(1).max(MAX_BATCH);

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

// --- Bulk actions on the business list (checkbox selection, PLAN.md's
// console list needs the same batch tools a list of ~50-200 businesses
// eventually calls for: suspending a cohort, granting an operator access to
// several at once, cleaning up demo/trial businesses). Every one starts with
// requireSuperadminContext, validates ids with zod and caps the batch at
// MAX_BATCH — the same guardrails the single-row actions above already
// carry, just per id in a loop. -------------------------------------------

export type BulkResultState = { message: string | null; error: string | null };

const bulkIdsFormSchema = z.object({ tenantIds: idsSchema });

function parseBulkIds(formData: FormData) {
  return bulkIdsFormSchema.safeParse({ tenantIds: formData.getAll("tenantId") });
}

export async function bulkSuspendTenantsAction(
  _prev: BulkResultState,
  formData: FormData,
): Promise<BulkResultState> {
  const ctx = await requireSuperadminContext();
  const parsed = parseBulkIds(formData);
  if (!parsed.success) return { message: null, error: "unknown" };

  for (const tenantId of parsed.data.tenantIds) {
    await suspendTenant(ctx, tenantId);
  }

  revalidatePath("/tenants", "layout");
  return { message: `bulkSuspended:${parsed.data.tenantIds.length}`, error: null };
}

export async function bulkActivateTenantsAction(
  _prev: BulkResultState,
  formData: FormData,
): Promise<BulkResultState> {
  const ctx = await requireSuperadminContext();
  const parsed = parseBulkIds(formData);
  if (!parsed.success) return { message: null, error: "unknown" };

  for (const tenantId of parsed.data.tenantIds) {
    await activateTenant(ctx, tenantId);
  }

  revalidatePath("/tenants", "layout");
  return { message: `bulkActivated:${parsed.data.tenantIds.length}`, error: null };
}

const bulkGrantAccessSchema = z.object({
  tenantIds: idsSchema,
  email: z.string().email().max(320),
  role: z.enum(["admin", "agent"]),
});

export type BulkGrantAccessState = {
  message: string | null;
  error: string | null;
  values: Record<string, string>;
};

/**
 * "Dar acceso a…" on several businesses at once: adds one membership per
 * selected business for an existing user, reusing `addMembership` and the
 * same superadmin-target guard `addExistingUserToTenantAction`
 * ([id]/actions.ts) enforces one row at a time. Businesses where the user is
 * already a member are skipped, not failed — the point of "select several"
 * is not having to know in advance which ones already have them.
 */
export async function bulkGrantAccessAction(
  _prev: BulkGrantAccessState,
  formData: FormData,
): Promise<BulkGrantAccessState> {
  const superadmin = await requireSuperadminContext();
  const values = { email: String(formData.get("email") ?? ""), role: String(formData.get("role") ?? "") };

  const parsed = bulkGrantAccessSchema.safeParse({
    tenantIds: formData.getAll("tenantId"),
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { message: null, error: "invalid", values };

  const user = await getUserByEmail(parsed.data.email);
  if (!user) return { message: null, error: "userNotFound", values };
  if (user.isSuperadmin) return { message: null, error: "superadminTarget", values };

  let added = 0;
  let skipped = 0;
  for (const tenantId of parsed.data.tenantIds) {
    try {
      await addMembership({ userId: user.id, tenantId, role: parsed.data.role });
    } catch (err) {
      if (err instanceof MembershipError && err.code === "alreadyMember") {
        skipped += 1;
        continue;
      }
      throw err;
    }
    await writeAuditLog({
      tenantId,
      actorUserId: superadmin.userId,
      action: "membership.added",
      entity: "user",
      entityId: user.id,
    });
    added += 1;
  }

  revalidatePath("/tenants", "layout");
  return { message: `bulkGranted:${added}:${skipped}`, error: null, values: {} };
}

const bulkDeleteSchema = z.object({
  tenantIds: idsSchema,
  confirm: z.string(),
});

export type BulkDeleteState = { message: string | null; error: string | null };

/**
 * Bulk "Eliminar": the same hard delete as the single-business danger zone
 * (`deleteTenant`, src/modules/tenancy/purge.ts), looped, behind a typed
 * "ELIMINAR <n>" confirmation the client renders with the exact selected
 * count — checked again here so a stale form can't slip a bigger batch
 * through than what was typed.
 */
export async function bulkDeleteTenantsAction(
  _prev: BulkDeleteState,
  formData: FormData,
): Promise<BulkDeleteState> {
  const ctx = await requireSuperadminContext();
  const parsed = bulkDeleteSchema.safeParse({
    tenantIds: formData.getAll("tenantId"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { message: null, error: "unknown" };

  const expected = `ELIMINAR ${parsed.data.tenantIds.length}`;
  if (parsed.data.confirm.trim() !== expected) {
    return { message: null, error: "confirmMismatch" };
  }

  let deleted = 0;
  for (const tenantId of parsed.data.tenantIds) {
    const ok = await deleteTenant(ctx, tenantId);
    if (ok) deleted += 1;
  }

  revalidatePath("/tenants", "layout");
  return { message: `bulkDeleted:${deleted}`, error: null };
}
