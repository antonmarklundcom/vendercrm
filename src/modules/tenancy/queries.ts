import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tenants } from "@/db/schema/tenancy";
import { user } from "@/db/schema/auth";
import { getSuperadminContext } from "./context";
import type { TenantContext } from "./context";

async function findTenantById(id: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return tenant ?? null;
}

async function findTenantUsers(tenantId: string) {
  return db.select().from(user).where(eq(user.tenantId, tenantId));
}

export async function listTenants() {
  await getSuperadminContext();
  return db.select().from(tenants).orderBy(desc(tenants.createdAt));
}

export async function getTenantById(id: string) {
  await getSuperadminContext();
  return findTenantById(id);
}

export async function listTenantUsers(tenantId: string) {
  await getSuperadminContext();
  return findTenantUsers(tenantId);
}

/** Self-service lookup for a tenant user's own tenant — no superadmin guard. */
export async function getMyTenant(ctx: TenantContext) {
  return findTenantById(ctx.tenantId);
}

/** Self-service lookup for a tenant user's own teammates — no superadmin guard. */
export async function listMyTenantUsers(ctx: TenantContext) {
  return findTenantUsers(ctx.tenantId);
}
