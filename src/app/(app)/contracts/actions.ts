"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantContext, requireTenantAdmin } from "@/modules/tenancy/context";
import {
  createContract,
  createContractTemplate,
  generateContractPdf,
  getContract,
  publicContractUrl,
  sendContract,
  updateContractTemplate,
  voidContract,
  UnknownTemplateVariableError,
} from "@/modules/contracts/contracts";
import { getTenant } from "@/modules/tenancy/tenants";
import { getTranslator } from "@/lib/i18n/translator";
import { sendLinkEmail } from "@/lib/email/document-delivery";
import { createActivity } from "@/modules/crm/activities";

// Server actions for /contracts and /contracts/[id] (PLAN.md §17.2 P13).
// Errors are stable codes, not copy (§13 H5 #4) — the caller's page turns
// them into the reader's own language.

const createContractSchema = z.object({
  templateId: z.string().min(1),
  contactId: z.string().min(1),
  dealId: z.string().optional(),
  quoteId: z.string().optional(),
});

export type ContractFormState = { error: string | null };

export async function createContractAction(
  _prevState: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const parsed = createContractSchema.safeParse({
    templateId: formData.get("templateId"),
    contactId: formData.get("contactId"),
    dealId: formData.get("dealId") || undefined,
    quoteId: formData.get("quoteId") || undefined,
  });
  if (!parsed.success) return { error: "invalid" };

  const ctx = await requireTenantContext();
  const contract = await createContract(ctx, parsed.data);
  redirect(`/contracts/${contract.id}`);
}

export async function sendContractAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = z.string().min(1).safeParse(formData.get("contractId"));
  if (!parsed.success) return;
  await sendContract(ctx, parsed.data);
  revalidatePath(`/contracts/${parsed.data}`);
}

export async function sendContractByEmailAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const parsed = z.string().min(1).safeParse(formData.get("contractId"));
  if (!parsed.success) return;

  const contract = await getContract(ctx, parsed.data);
  if (!contract) return;

  const [pdf, tenant] = await Promise.all([
    generateContractPdf(ctx, contract.id),
    getTenant(ctx.tenantId),
  ]);
  const t = await getTranslator(tenant?.locale, "pdf.contract");
  const url = publicContractUrl(contract.publicToken);

  const result = await sendLinkEmail(ctx, {
    contactId: contract.contactId,
    subject: `${t("caption")} ${contract.number}`,
    lines: [`${t("caption")} ${contract.number}.`],
    linkLabel: url,
    linkUrl: url,
    attachment: { filename: `${contract.number}.pdf`, content: pdf },
  });

  if (result.sent) {
    await createActivity(ctx, {
      contactId: contract.contactId,
      dealId: contract.dealId ?? undefined,
      type: "system",
      payload: { kind: "contract_sent", contractId: contract.id, number: contract.number, viaEmail: true },
      userId: ctx.userId,
    });
  }

  revalidatePath(`/contracts/${parsed.data}`);
}

const voidSchema = z.object({
  contractId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

export async function voidContractAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const parsed = voidSchema.safeParse({
    contractId: formData.get("contractId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return;
  await voidContract(ctx, parsed.data.contractId, parsed.data.reason);
  revalidatePath(`/contracts/${parsed.data.contractId}`);
}

const templateSchema = z.object({
  name: z.string().min(1).max(200),
  body: z.string().min(1),
});

export type TemplateFormState = { error: string | null; variable?: string };

export async function createTemplateAction(
  _prevState: TemplateFormState,
  formData: FormData,
): Promise<TemplateFormState> {
  const parsed = templateSchema.safeParse({ name: formData.get("name"), body: formData.get("body") });
  if (!parsed.success) return { error: "invalid" };

  const ctx = await requireTenantAdmin();
  try {
    await createContractTemplate(ctx, parsed.data);
  } catch (err) {
    if (err instanceof UnknownTemplateVariableError) {
      return { error: "unknownVariable", variable: err.variable };
    }
    throw err;
  }
  revalidatePath("/contracts/templates");
  return { error: null };
}

const updateTemplateSchema = templateSchema.extend({
  templateId: z.string().min(1),
  isActive: z.coerce.boolean().optional(),
});

export async function updateTemplateAction(
  _prevState: TemplateFormState,
  formData: FormData,
): Promise<TemplateFormState> {
  const parsed = updateTemplateSchema.safeParse({
    templateId: formData.get("templateId"),
    name: formData.get("name"),
    body: formData.get("body"),
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) return { error: "invalid" };

  const ctx = await requireTenantAdmin();
  try {
    await updateContractTemplate(ctx, parsed.data.templateId, {
      name: parsed.data.name,
      body: parsed.data.body,
      isActive: parsed.data.isActive ?? true,
    });
  } catch (err) {
    if (err instanceof UnknownTemplateVariableError) {
      return { error: "unknownVariable", variable: err.variable };
    }
    throw err;
  }
  revalidatePath("/contracts/templates");
  return { error: null };
}
