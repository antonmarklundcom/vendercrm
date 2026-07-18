import { eq } from "drizzle-orm";
import { products } from "@/db/schema";
import { newId } from "@/lib/ids";
import { tenantDb } from "@/modules/tenancy/db";
import type { TenantContext } from "@/modules/tenancy/types";

export async function listProducts(ctx: TenantContext, activeOnly = false) {
  const rows = await tenantDb(ctx).select(products);
  return activeOnly ? rows.filter((p) => p.isActive) : rows;
}

export async function getProduct(ctx: TenantContext, productId: string) {
  const [row] = await tenantDb(ctx).select(products, eq(products.id, productId));
  return row ?? null;
}

export async function createProduct(
  ctx: TenantContext,
  input: {
    name: string;
    description?: string;
    unitPrice: number;
    currency?: string;
  },
): Promise<string> {
  const id = newId();
  await tenantDb(ctx).insert(products, {
    id,
    name: input.name,
    description: input.description ?? null,
    unitPrice: input.unitPrice,
    currency: input.currency ?? "PYG",
  });
  return id;
}

export async function setProductActive(
  ctx: TenantContext,
  productId: string,
  isActive: boolean,
): Promise<void> {
  await tenantDb(ctx).update(products, { isActive }, eq(products.id, productId));
}
