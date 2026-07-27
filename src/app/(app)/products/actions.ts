"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTenantOperator } from "@/modules/tenancy/context";
import { createProduct, updateProduct } from "@/modules/quotes/products";

const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().or(z.literal("")),
  // Guaraníes are whole units (§2.3) — no decimals to parse.
  unitPrice: z.coerce.number().int().min(0),
});

export async function createProductAction(formData: FormData) {
  const ctx = await requireTenantOperator();
  const input = createProductSchema.parse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    unitPrice: formData.get("unitPrice"),
  });
  await createProduct(ctx, {
    name: input.name,
    description: input.description || undefined,
    unitPrice: input.unitPrice,
  });
  revalidatePath("/products");
}

export async function toggleProductAction(formData: FormData) {
  const ctx = await requireTenantOperator();
  const id = z.string().min(1).parse(formData.get("productId"));
  const isActive = formData.get("isActive") === "true";
  await updateProduct(ctx, id, { isActive });
  revalidatePath("/products");
}
