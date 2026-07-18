"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenantContext } from "@/modules/tenancy/context";
import { assertWritable } from "@/modules/tenancy/access";
import { createProduct } from "@/modules/quotes/products";
import { createQuote, type QuoteLineInput } from "@/modules/quotes/service";
import { generateQuotePdf } from "@/modules/quotes/generate";
import { sendQuoteViaWhatsApp } from "@/modules/quotes/delivery";

async function writableCtx() {
  const ctx = await requireTenantContext();
  await assertWritable(ctx.tenantId);
  return ctx;
}

const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  unitPrice: z.coerce.number().int().nonnegative(),
});

export async function createProductAction(formData: FormData) {
  const ctx = await writableCtx();
  const input = productSchema.parse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    unitPrice: formData.get("unitPrice"),
  });
  await createProduct(ctx, input);
  revalidatePath("/app/quotes/products");
}

const lineSchema = z.object({
  description: z.string().min(1),
  qty: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().int().nonnegative(),
  productId: z.string().optional(),
});

const quoteSchema = z.object({
  contactId: z.string().min(1),
  dealId: z.string().optional(),
  discount: z.coerce.number().int().nonnegative().default(0),
  validUntil: z.string().optional(),
  notes: z.string().optional(),
});

export async function createQuoteAction(formData: FormData) {
  const ctx = await writableCtx();
  const input = quoteSchema.parse({
    contactId: formData.get("contactId"),
    dealId: formData.get("dealId") || undefined,
    discount: formData.get("discount") || 0,
    validUntil: formData.get("validUntil") || undefined,
    notes: formData.get("notes") || undefined,
  });

  const descriptions = formData.getAll("line_description") as string[];
  const qtys = formData.getAll("line_qty") as string[];
  const prices = formData.getAll("line_unitPrice") as string[];
  const productIds = formData.getAll("line_productId") as string[];

  const lines: QuoteLineInput[] = descriptions
    .map((description, i) =>
      lineSchema.parse({
        description,
        qty: qtys[i],
        unitPrice: prices[i],
        productId: productIds[i] || undefined,
      }),
    )
    .filter((l) => l.description.trim().length > 0);

  if (lines.length === 0) {
    throw new Error("Agregá al menos una línea al presupuesto");
  }

  const quoteId = await createQuote(ctx, {
    contactId: input.contactId,
    dealId: input.dealId || null,
    lines,
    discount: input.discount,
    validUntil: input.validUntil ? new Date(input.validUntil) : null,
    notes: input.notes || null,
  });

  await generateQuotePdf(ctx, quoteId);
  revalidatePath("/app/quotes");
  redirect(`/app/quotes/${quoteId}`);
}

export async function sendQuoteAction(quoteId: string) {
  const ctx = await writableCtx();
  await sendQuoteViaWhatsApp(ctx, quoteId);
  revalidatePath(`/app/quotes/${quoteId}`);
}
