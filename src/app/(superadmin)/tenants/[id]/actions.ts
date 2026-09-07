"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { buildSystemTenantContext, requireSuperadminContext } from "@/modules/tenancy/context";
import { createSubscription, recordPayment } from "@/modules/tenancy/subscriptions";
import { connectAccountManually, disconnectAccount } from "@/modules/whatsapp/accounts";
import {
  createTenantAdminUser,
  getUserByEmail,
  getUserById,
  updateUserProfile,
  UserProfileError,
} from "@/modules/tenancy/users";
import { addMembership, MembershipError } from "@/modules/tenancy/memberships";
import { writeAuditLog } from "@/modules/tenancy/audit";
import { startImpersonation } from "@/modules/auth/impersonation";
import { redirect } from "next/navigation";
import { env } from "@/lib/config/env";
import { auth } from "@/lib/auth/server";
import { withResetUrlCapture } from "@/lib/auth/reset-capture";

const createSubscriptionSchema = z.object({
  tenantId: z.string().min(1),
  planId: z.string().min(1),
});

// useActionState-shaped (PLAN.md §10 1R #6): the plan picker is a real
// user-fillable field, so a rejected submit comes back inline instead of
// throwing to Next's error page.
export type SubscriptionField = "planId";

export type SubscriptionFormState = {
  error: string | null;
  field: SubscriptionField | null;
  values: Record<string, string>;
};

export async function createSubscriptionAction(
  _prevState: SubscriptionFormState,
  formData: FormData,
): Promise<SubscriptionFormState> {
  const ctx = await requireSuperadminContext();
  const values = Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  const parsed = createSubscriptionSchema.safeParse({
    tenantId: formData.get("tenantId"),
    planId: formData.get("planId"),
  });

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "planId") return { error: "planRequired", field: "planId", values };
    return { error: "unknown", field: null, values };
  }

  try {
    await createSubscription(ctx, parsed.data);
  } catch {
    // createSubscription throws on an unknown plan id; that is the same
    // "pick a real plan" problem from the user's side.
    return { error: "planRequired", field: "planId", values };
  }

  revalidatePath(`/tenants/${parsed.data.tenantId}`);
  return { error: null, field: null, values: {} };
}

// Amounts are integer minor units (§2.3) — the same rule the tenant-side
// documents ledger follows, so the schema and the failure keys match
// documents/actions.ts's recordPaymentAction rather than inventing a second
// money shape for the superadmin console.
const recordPaymentSchema = z.object({
  tenantId: z.string().min(1),
  subscriptionId: z.string().min(1),
  amount: z.coerce.number().int().positive(),
  method: z.enum(["transfer", "cash", "other"]),
  reference: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export type RecordPaymentField = "amount";

export type RecordPaymentFormState = {
  error: string | null;
  field: RecordPaymentField | null;
  values: Record<string, string>;
};

export async function recordPaymentAction(
  _prevState: RecordPaymentFormState,
  formData: FormData,
): Promise<RecordPaymentFormState> {
  const ctx = await requireSuperadminContext();
  const values = Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  const parsed = recordPaymentSchema.safeParse({
    tenantId: formData.get("tenantId"),
    subscriptionId: formData.get("subscriptionId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "amount") {
      return { error: "amountInvalid", field: "amount", values };
    }
    return { error: "unknown", field: null, values };
  }

  try {
    await recordPayment(ctx, {
      subscriptionId: parsed.data.subscriptionId,
      amount: parsed.data.amount,
      method: parsed.data.method,
      reference: parsed.data.reference,
      notes: parsed.data.notes,
    });
  } catch {
    return { error: "unknown", field: null, values };
  }

  revalidatePath(`/tenants/${parsed.data.tenantId}`);
  return { error: null, field: null, values: {} };
}

// Direct user creation (PLAN.md §10 1I #3). Before this, standing up a
// tenant's first admin meant running scripts/seed-tenant.ts over SSH — the
// superadmin console could create the tenant but nobody who could log into
// it. Sets the password directly (no email delivery exists yet, §10 1L), so
// the superadmin hands over the credentials out of band.
const createTenantUserSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
  role: z.enum(["admin", "agent"]),
});

export type CreateTenantUserState = { error: string | null; createdEmail: string | null };

export async function createTenantUserAction(
  _prevState: CreateTenantUserState,
  formData: FormData,
): Promise<CreateTenantUserState> {
  await requireSuperadminContext();

  const parsed = createTenantUserSchema.safeParse({
    tenantId: formData.get("tenantId"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: "invalid", createdEmail: null };
  }

  const existing = await getUserByEmail(parsed.data.email);
  if (existing) {
    return { error: "emailTaken", createdEmail: null };
  }

  await createTenantAdminUser({
    tenantId: parsed.data.tenantId,
    name: parsed.data.name,
    email: parsed.data.email,
    password: parsed.data.password,
    role: parsed.data.role,
  });

  revalidatePath(`/tenants/${parsed.data.tenantId}`);
  return { error: null, createdEmail: parsed.data.email };
}

// Granting an existing person access to a second business (PLAN.md §3.1,
// reopened). Superadmin-only *by design*, not by omission: adding someone to
// a business is a cross-tenant write, which §3.3 exists to keep out of a
// tenant admin's hands. What a tenant admin keeps is the role of someone
// already in their own business, and the power to remove them from it.
const addExistingUserSchema = z.object({
  tenantId: z.string().min(1),
  email: z.string().email().max(320),
  role: z.enum(["admin", "agent"]),
});

export type AddExistingUserState = { error: string | null; addedEmail: string | null };

export async function addExistingUserToTenantAction(
  _prevState: AddExistingUserState,
  formData: FormData,
): Promise<AddExistingUserState> {
  const superadmin = await requireSuperadminContext();

  const parsed = addExistingUserSchema.safeParse({
    tenantId: formData.get("tenantId"),
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: "invalid", addedEmail: null };
  }

  const user = await getUserByEmail(parsed.data.email);
  if (!user) {
    return { error: "userNotFound", addedEmail: null };
  }
  // A superadmin already reaches every tenant through impersonation; giving
  // them a membership as well would put a platform account inside a tenant's
  // team list, where a tenant admin could deactivate or demote it.
  if (user.isSuperadmin) {
    return { error: "superadminTarget", addedEmail: null };
  }

  try {
    await addMembership({
      userId: user.id,
      tenantId: parsed.data.tenantId,
      role: parsed.data.role,
    });
  } catch (err) {
    if (err instanceof MembershipError && err.code === "alreadyMember") {
      return { error: "alreadyMember", addedEmail: null };
    }
    throw err;
  }

  await writeAuditLog({
    tenantId: parsed.data.tenantId,
    actorUserId: superadmin.userId,
    action: "membership.added",
    entity: "user",
    entityId: user.id,
  });

  revalidatePath(`/tenants/${parsed.data.tenantId}`);
  return { error: null, addedEmail: parsed.data.email };
}

const impersonateSchema = z.object({
  userId: z.string().min(1),
  // Which business to act in. One person can be in several (PLAN.md §3.1), so
  // "ver como" from *this* tenant's page has to mean this tenant.
  tenantId: z.string().min(1),
});

// Hidden-id-only, and deliberately *not* given form state (PLAN.md §10 1R
// #6 leaves that judgment per action). Two reasons:
//
//  1. There is no user-fillable field. The id comes from the rendered user
//     list, so a rejected submit has nothing to sit under — the same
//     reasoning as the issue/send/suspend buttons.
//  2. A rendered failure would answer "does this user id exist?" for
//     anything posted at the endpoint. Silence is the only response that
//     doesn't distinguish a missing user from a superadmin target from a
//     malformed id.
//
// startImpersonation swaps the acting session, so ordering matters: the
// parse, the lookup and the guards all run before Better Auth is touched,
// and redirect() stays outside the try so its control-flow throw isn't
// swallowed. Any rejection therefore returns with the session untouched and
// the superadmin still on the tenant page — never half-swapped.
export async function impersonateAction(formData: FormData) {
  const parsed = impersonateSchema.safeParse({
    userId: formData.get("userId"),
    tenantId: formData.get("tenantId"),
  });
  if (!parsed.success) return;

  try {
    await startImpersonation(parsed.data.userId, parsed.data.tenantId);
  } catch {
    return;
  }

  redirect("/dashboard");
}

/**
 * "Configurar con IA" (K2, PLAN.md §16.5 entry point #3): the same
 * impersonation swap as "Ver como" above, landing on `/onboarding` instead
 * of the dashboard so the setup assistant's guard (tenant admin) and audit
 * trail (actorUserId is the impersonated admin, impersonatorUserId is the
 * superadmin) are exactly the tenant's own — no separate code path.
 */
export async function configureWithAiAction(formData: FormData) {
  const parsed = impersonateSchema.safeParse({
    userId: formData.get("userId"),
    tenantId: formData.get("tenantId"),
  });
  if (!parsed.success) return;

  try {
    await startImpersonation(parsed.data.userId, parsed.data.tenantId);
  } catch {
    return;
  }

  redirect("/onboarding");
}


// --- Member profile edit (PLAN.md §3.1: adding/removing/editing a person on
// a business's roster is a superadmin action, since `users` is a platform
// table) ---------------------------------------------------------------

const updateProfileSchema = z.object({
  tenantId: z.string().min(1).max(26),
  userId: z.string().min(1).max(26),
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
});

export type UpdateMemberProfileField = "name" | "email";

export type UpdateMemberProfileState = {
  error: string | null;
  field: UpdateMemberProfileField | null;
  success: boolean;
};

export async function updateTenantMemberProfileAction(
  _prevState: UpdateMemberProfileState,
  formData: FormData,
): Promise<UpdateMemberProfileState> {
  const ctx = await requireSuperadminContext();

  const parsed = updateProfileSchema.safeParse({
    tenantId: formData.get("tenantId"),
    userId: formData.get("userId"),
    name: formData.get("name"),
    email: formData.get("email"),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "name" || field === "email") {
      return { error: "invalid", field, success: false };
    }
    return { error: "invalid", field: null, success: false };
  }

  const target = await getUserById(parsed.data.userId);
  if (!target || target.tenantId !== parsed.data.tenantId) {
    return { error: "unknown", field: null, success: false };
  }

  try {
    await updateUserProfile(target.id, { name: parsed.data.name, email: parsed.data.email });
  } catch (err) {
    if (err instanceof UserProfileError && err.code === "emailTaken") {
      return { error: "emailTaken", field: "email", success: false };
    }
    throw err;
  }

  await writeAuditLog({
    tenantId: parsed.data.tenantId,
    actorUserId: ctx.userId,
    action: "user.profile_updated",
    entity: "user",
    entityId: target.id,
    payload: { name: parsed.data.name, email: parsed.data.email },
  });

  revalidatePath(`/tenants/${parsed.data.tenantId}`);
  return { error: null, field: null, success: true };
}

// --- Password reset link (feature parity with the tenant admin's own
// sendPasswordResetAction — same Better Auth request-password-reset flow,
// with the resulting link also shown on screen, the way invitations already
// are when Resend isn't configured — DEPLOY.md §4). Superadmin-only, and
// deliberately not the public /forgot-password flow: the superadmin already
// knows the target account exists (it's in the tenant's own member list), so
// there is no timing-attack reason to hide the link the way the public
// "check your email" response has to.
const resetPasswordLinkSchema = z.object({
  tenantId: z.string().min(1).max(26),
  userId: z.string().min(1).max(26),
});

export type ResetPasswordLinkState = { error: string | null; resetUrl: string | null };

export async function resetTenantMemberPasswordAction(
  _prevState: ResetPasswordLinkState,
  formData: FormData,
): Promise<ResetPasswordLinkState> {
  const ctx = await requireSuperadminContext();

  const parsed = resetPasswordLinkSchema.safeParse({
    tenantId: formData.get("tenantId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) return { error: "unknown", resetUrl: null };

  const target = await getUserById(parsed.data.userId);
  if (!target || target.tenantId !== parsed.data.tenantId) {
    return { error: "unknown", resetUrl: null };
  }

  const { url } = await withResetUrlCapture(() =>
    auth.api.requestPasswordReset({
      body: { email: target.email, redirectTo: `${env.APP_URL}/reset-password` },
    }),
  );

  if (!url) return { error: "unknown", resetUrl: null };

  await writeAuditLog({
    tenantId: target.tenantId,
    actorUserId: ctx.userId,
    action: "user.password_reset_link_generated",
    entity: "user",
    entityId: target.id,
    payload: { email: target.email },
  });

  revalidatePath(`/tenants/${parsed.data.tenantId}`);
  return { error: null, resetUrl: url };
}

// --- WhatsApp connection, on the tenant's behalf (PLAN.md §6.2). Same
// manual-connect service the tenant admin's own form calls
// (`modules/whatsapp/accounts.ts`'s `connectAccountManually`) and the same
// encrypted-at-rest token handling (§3.4) — this is "expose the existing
// capability to superadmin, tenant-scoped", not a second WhatsApp
// integration. `buildSystemTenantContext` builds the tenant context the
// module services expect from a plain tenant id, exactly as
// whatsapp-health/actions.ts's `syncTemplatesAction` already does when
// acting on a tenant's behalf. ---------------------------------------------

const connectWhatsappSchema = z.object({
  tenantId: z.string().min(1).max(26),
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
  displayNumber: z.string().optional().or(z.literal("")),
  accessToken: z.string().min(1),
});

export type ConnectWhatsappField = "wabaId" | "phoneNumberId" | "accessToken";

export type ConnectWhatsappState = {
  error: string | null;
  field: ConnectWhatsappField | null;
  values: Record<string, string>;
};

const CONNECT_WHATSAPP_FIELD_ERRORS: Record<ConnectWhatsappField, string> = {
  wabaId: "wabaIdRequired",
  phoneNumberId: "phoneNumberIdRequired",
  accessToken: "accessTokenRequired",
};

export async function connectTenantWhatsappAction(
  _prevState: ConnectWhatsappState,
  formData: FormData,
): Promise<ConnectWhatsappState> {
  const superadmin = await requireSuperadminContext();

  // accessToken is dropped rather than echoed: this state is serialized back
  // to the browser, and the token is a per-tenant secret (§3.4) that only
  // ever belongs in wa_accounts encrypted — same rule the tenant-side form
  // follows.
  const values = Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[0] !== "accessToken",
    ),
  );

  const parsed = connectWhatsappSchema.safeParse({
    tenantId: formData.get("tenantId"),
    wabaId: formData.get("wabaId"),
    phoneNumberId: formData.get("phoneNumberId"),
    displayNumber: formData.get("displayNumber") || undefined,
    accessToken: formData.get("accessToken"),
  });

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (typeof field === "string" && field in CONNECT_WHATSAPP_FIELD_ERRORS) {
      const key = field as ConnectWhatsappField;
      return { error: CONNECT_WHATSAPP_FIELD_ERRORS[key], field: key, values };
    }
    return { error: "unknown", field: null, values };
  }

  const tenantCtx = await buildSystemTenantContext(parsed.data.tenantId);
  if (!tenantCtx) return { error: "unknown", field: null, values };

  try {
    await connectAccountManually(tenantCtx, {
      wabaId: parsed.data.wabaId,
      phoneNumberId: parsed.data.phoneNumberId,
      displayNumber: parsed.data.displayNumber,
      accessToken: parsed.data.accessToken,
    });
  } catch {
    return { error: "unknown", field: null, values };
  }

  await writeAuditLog({
    tenantId: parsed.data.tenantId,
    actorUserId: superadmin.userId,
    action: "whatsapp.connected_by_superadmin",
    entity: "tenant",
    entityId: parsed.data.tenantId,
    payload: { wabaId: parsed.data.wabaId, phoneNumberId: parsed.data.phoneNumberId },
  });

  revalidatePath(`/tenants/${parsed.data.tenantId}`);
  return { error: null, field: null, values: {} };
}

const disconnectWhatsappSchema = z.object({
  tenantId: z.string().min(1).max(26),
  accountId: z.string().min(1).max(26),
});

/**
 * Clears a broken (or unwanted) connection. No form state: the account id
 * comes from the rendered list, same as the impersonate button — there is
 * no user-fillable field for a rejection to sit under.
 */
export async function disconnectTenantWhatsappAction(formData: FormData) {
  const superadmin = await requireSuperadminContext();

  const parsed = disconnectWhatsappSchema.safeParse({
    tenantId: formData.get("tenantId"),
    accountId: formData.get("accountId"),
  });
  if (!parsed.success) return;

  const tenantCtx = await buildSystemTenantContext(parsed.data.tenantId);
  if (!tenantCtx) return;

  await disconnectAccount(tenantCtx, parsed.data.accountId);

  await writeAuditLog({
    tenantId: parsed.data.tenantId,
    actorUserId: superadmin.userId,
    action: "whatsapp.disconnected_by_superadmin",
    entity: "wa_account",
    entityId: parsed.data.accountId,
  });

  revalidatePath(`/tenants/${parsed.data.tenantId}`);
}
