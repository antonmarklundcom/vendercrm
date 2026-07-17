"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/modules/auth/server";
import { requireSuperadmin } from "@/modules/tenancy/context";
import {
  createTenant,
  setTenantStatus,
  listTenantUsers,
} from "@/modules/tenancy/service";
import { createPlan, setPlanActive, recordPayment } from "@/modules/billing/service";
import { audit } from "@/modules/audit";

const createTenantSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Solo minúsculas, números y guiones"),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
});

export async function createTenantAction(formData: FormData) {
  const ctx = await requireSuperadmin();
  const input = createTenantSchema.parse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    adminName: formData.get("adminName"),
    adminEmail: formData.get("adminEmail"),
    adminPassword: formData.get("adminPassword"),
  });
  const { tenantId } = await createTenant(input);
  await audit(ctx, {
    action: "tenant.create",
    tenantId,
    entity: "tenant",
    entityId: tenantId,
    payload: { slug: input.slug },
  });
  revalidatePath("/superadmin");
  redirect(`/superadmin/tenants/${tenantId}`);
}

const statusSchema = z.enum(["active", "suspended", "trial"]);

export async function setTenantStatusAction(tenantId: string, status: string) {
  const ctx = await requireSuperadmin();
  const parsed = statusSchema.parse(status);
  await setTenantStatus(tenantId, parsed);
  await audit(ctx, {
    action: "tenant.set_status",
    tenantId,
    entity: "tenant",
    entityId: tenantId,
    payload: { status: parsed },
  });
  revalidatePath(`/superadmin/tenants/${tenantId}`);
  revalidatePath("/superadmin");
}

const createPlanSchema = z.object({
  name: z.string().min(1),
  durationMonths: z.coerce.number().int().positive(),
  price: z.coerce.number().int().nonnegative(),
});

export async function createPlanAction(formData: FormData) {
  const ctx = await requireSuperadmin();
  const input = createPlanSchema.parse({
    name: formData.get("name"),
    durationMonths: formData.get("durationMonths"),
    price: formData.get("price"),
  });
  const planId = await createPlan(input);
  await audit(ctx, {
    action: "plan.create",
    entity: "plan",
    entityId: planId,
    payload: input,
  });
  revalidatePath("/superadmin/plans");
}

export async function setPlanActiveAction(planId: string, isActive: boolean) {
  const ctx = await requireSuperadmin();
  await setPlanActive(planId, isActive);
  await audit(ctx, {
    action: "plan.set_active",
    entity: "plan",
    entityId: planId,
    payload: { isActive },
  });
  revalidatePath("/superadmin/plans");
}

const recordPaymentSchema = z.object({
  tenantId: z.string().min(1),
  planId: z.string().min(1),
  amount: z.coerce.number().int().nonnegative(),
  method: z.enum(["transfer", "cash", "other"]),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

export async function recordPaymentAction(formData: FormData) {
  const ctx = await requireSuperadmin();
  const input = recordPaymentSchema.parse({
    tenantId: formData.get("tenantId"),
    planId: formData.get("planId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference") || undefined,
    notes: formData.get("notes") || undefined,
  });
  const { subscriptionId, expiresAt } = await recordPayment({
    ...input,
    recordedByUserId: ctx.userId,
  });
  await audit(ctx, {
    action: "payment.record",
    tenantId: input.tenantId,
    entity: "subscription",
    entityId: subscriptionId,
    payload: { amount: input.amount, method: input.method, expiresAt },
  });
  revalidatePath(`/superadmin/tenants/${input.tenantId}`);
}

export async function impersonateAction(tenantId: string) {
  const ctx = await requireSuperadmin();
  // Impersonate the tenant's admin user (the first admin found).
  const users = await listTenantUsers({
    tenantId,
    userId: ctx.userId,
    role: "admin",
    isSuperadmin: true,
    impersonatorUserId: null,
  });
  const target = users.find((u) => u.tenantRole === "admin") ?? users[0];
  if (!target) throw new Error("La empresa no tiene usuarios para impersonar");

  await auth.api.impersonateUser({
    body: { userId: target.id },
    headers: await headers(),
  });
  await audit(ctx, {
    action: "user.impersonate",
    tenantId,
    entity: "user",
    entityId: target.id,
  });
  redirect("/app");
}
