"use server";

import { z } from "zod";
import { preprocessAmount } from "@/lib/money";
import { revalidatePath } from "next/cache";
import { requireTenantAdmin } from "@/modules/tenancy/context";
import { createProduct, updateProduct } from "@/modules/quotes/products";

// The catalog is tenant configuration (§3.2): agents sell from it — and so
// still read it on /products, /quotes and /documents — but only an admin
// adds a product or takes one out of circulation.

// useActionState-shaped (PLAN.md §10 1R #6): a bad price or a missing name
// comes back as state rendered next to the input, not Next's error page.
export type ProductField = "name" | "unitPrice";

export type ProductFormState = {
  error: string | null;
  field: ProductField | null;
  values: Record<string, string>;
};

const PRODUCT_FIELD_ERRORS: Record<ProductField, string> = {
  name: "nameRequired",
  unitPrice: "unitPriceInvalid",
};

const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().or(z.literal("")),
  // Guaraníes are whole units (§2.3) — no decimals to parse.
  unitPrice: z.preprocess(preprocessAmount, z.coerce.number().int().min(0)),
});

export async function createProductAction(
  _prevState: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const ctx = await requireTenantAdmin();
  const values = Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  const parsed = createProductSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    unitPrice: formData.get("unitPrice"),
  });

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (typeof field === "string" && field in PRODUCT_FIELD_ERRORS) {
      const key = field as ProductField;
      return { error: PRODUCT_FIELD_ERRORS[key], field: key, values };
    }
    return { error: "unknown", field: null, values };
  }

  try {
    await createProduct(ctx, {
      name: parsed.data.name,
      description: parsed.data.description || undefined,
      unitPrice: parsed.data.unitPrice,
    });
  } catch {
    return { error: "unknown", field: null, values };
  }

  revalidatePath("/products");
  return { error: null, field: null, values: {} };
}

export async function toggleProductAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = z.string().min(1).safeParse(formData.get("productId"));
  if (!parsed.success) return;
  const isActive = formData.get("isActive") === "true";
  await updateProduct(ctx, parsed.data, { isActive });
  revalidatePath("/products");
}
