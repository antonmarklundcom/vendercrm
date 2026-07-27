"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantOperator } from "@/modules/tenancy/context";
import { createQuote, setQuoteStatus } from "@/modules/quotes/quotes";
import { sendQuote } from "@/modules/quotes/delivery";

const lineSchema = z.object({
  description: z.string().min(1).max(500),
  qty: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().int().min(0),
  productId: z.string().optional(),
});

const createQuoteSchema = z.object({
  contactId: z.string().min(1),
  dealId: z.string().optional(),
  discount: z.coerce.number().int().min(0).optional(),
  validUntil: z.string().optional(),
  notes: z.string().max(5000).optional(),
  items: z.array(lineSchema).min(1),
});

export async function createQuoteAction(formData: FormData) {
  const ctx = await requireTenantOperator();

  // The builder posts parallel arrays, one entry per line.
  const descriptions = formData.getAll("description").map(String);
  const qtys = formData.getAll("qty").map(String);
  const prices = formData.getAll("unitPrice").map(String);
  const productIds = formData.getAll("productId").map(String);

  const items = descriptions
    .map((description, i) => ({
      description,
      qty: qtys[i],
      unitPrice: prices[i],
      productId: productIds[i] || undefined,
    }))
    // Blank rows are how the builder represents "not filled in yet".
    .filter((line) => line.description.trim().length > 0);

  const input = createQuoteSchema.parse({
    contactId: formData.get("contactId"),
    dealId: formData.get("dealId") || undefined,
    discount: formData.get("discount") || 0,
    validUntil: formData.get("validUntil") || undefined,
    notes: formData.get("notes") || undefined,
    items,
  });

  const quote = await createQuote(ctx, {
    contactId: input.contactId,
    dealId: input.dealId,
    discount: input.discount,
    validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
    notes: input.notes,
    items: input.items,
  });

  revalidatePath("/quotes");
  redirect(`/quotes/${quote!.id}`);
}

export async function sendQuoteAction(formData: FormData) {
  const ctx = await requireTenantOperator();
  const quoteId = z.string().min(1).parse(formData.get("quoteId"));
  await sendQuote(ctx, quoteId);
  revalidatePath(`/quotes/${quoteId}`);
}

export async function setQuoteStatusAction(formData: FormData) {
  const ctx = await requireTenantOperator();
  const quoteId = z.string().min(1).parse(formData.get("quoteId"));
  const status = z
    .enum(["draft", "sent", "accepted", "rejected", "expired"])
    .parse(formData.get("status"));
  await setQuoteStatus(ctx, quoteId, status);
  revalidatePath(`/quotes/${quoteId}`);
}
