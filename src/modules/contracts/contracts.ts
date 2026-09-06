import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contractAcceptances, contracts, contractTemplates } from "@/db/schema";
import { newId } from "@/lib/ids";
import { env } from "@/lib/config/env";
import { buildSystemTenantContext, type TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { writeAuditLog } from "@/modules/tenancy/audit";
import { getContact } from "@/modules/crm/contacts";
import { getTenant } from "@/modules/tenancy/tenants";
import { listCustomFieldDefinitions } from "@/modules/crm/custom-fields";
import { createActivity } from "@/modules/crm/activities";
import { checkRateLimit } from "@/lib/rate-limit";
import type { TenantSettings } from "@/modules/tenancy/settings";
import {
  sendDocumentOverWhatsapp,
  storeDocumentPdf,
} from "@/modules/renderable-document/delivery";
import { nextDocumentNumber } from "@/modules/documents/numbering";
import { renderContractPdf } from "./pdf";
import { findUnknownVariable, renderContractBody } from "./render";
import { contractEvents } from "./events";
import { DEFAULT_CONTRACT_TEMPLATES } from "./presets";

// Contracts (PLAN.md §15.2, §17.2 P13). §17.1 #5: acceptance ships as
// click-to-accept only, recorded as name typed, IP, user agent and the
// SHA-256 of the PDF bytes the visitor was shown — the evidentiary record a
// *firma electrónica simple* needs under Ley 4017/2010.

export type ContractRow = typeof contracts.$inferSelect;
export type ContractTemplateRow = typeof contractTemplates.$inferSelect;
export type ContractAcceptanceRow = typeof contractAcceptances.$inferSelect;

// --- Templates -------------------------------------------------------------

export async function listContractTemplates(ctx: TenantContext): Promise<ContractTemplateRow[]> {
  const rows = await tenantDb(ctx).select(contractTemplates);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getContractTemplate(
  ctx: TenantContext,
  id: string,
): Promise<ContractTemplateRow | null> {
  const [row] = await tenantDb(ctx).select(contractTemplates, eq(contractTemplates.id, id));
  return row ?? null;
}

/** Seeds the three vertical presets the first time a tenant opens
 *  `/contracts` (§17.3 P13) — a no-op once any template already exists, so
 *  a tenant who deletes all of them does not get them back on the next
 *  visit. */
export async function ensureDefaultContractTemplates(ctx: TenantContext): Promise<void> {
  const existing = await tenantDb(ctx).count(contractTemplates);
  if (existing > 0) return;

  for (const preset of DEFAULT_CONTRACT_TEMPLATES) {
    await tenantDb(ctx)
      .insert(contractTemplates)
      .values({ id: newId(), name: preset.name, body: preset.body, isActive: true });
  }
}

export class UnknownTemplateVariableError extends Error {
  constructor(public readonly variable: string) {
    super(`unknown_template_variable:${variable}`);
  }
}

async function assertKnownVariables(ctx: TenantContext, body: string): Promise<void> {
  const definitions = await listCustomFieldDefinitions(ctx);
  const unknown = findUnknownVariable(body, definitions.map((d) => d.key));
  if (unknown) throw new UnknownTemplateVariableError(unknown);
}

export async function createContractTemplate(
  ctx: TenantContext,
  input: { name: string; body: string },
): Promise<ContractTemplateRow> {
  await assertKnownVariables(ctx, input.body);
  const id = newId();
  await tenantDb(ctx)
    .insert(contractTemplates)
    .values({ id, name: input.name.slice(0, 200), body: input.body, isActive: true });
  return (await getContractTemplate(ctx, id))!;
}

export async function updateContractTemplate(
  ctx: TenantContext,
  id: string,
  input: { name: string; body: string; isActive: boolean },
): Promise<ContractTemplateRow | null> {
  await assertKnownVariables(ctx, input.body);
  await tenantDb(ctx)
    .update(contractTemplates)
    .set({ name: input.name.slice(0, 200), body: input.body, isActive: input.isActive })
    .where(eq(contractTemplates.id, id));
  return getContractTemplate(ctx, id);
}

// --- Contracts ---------------------------------------------------------

function newPublicToken(): string {
  return randomBytes(24).toString("hex");
}

export type CreateContractInput = {
  templateId: string;
  contactId: string;
  dealId?: string;
  quoteId?: string;
};

/** Creates a draft contract: renders the template snapshot against the
 *  contact's current values so the visible body always matches what will be
 *  sent, without freezing anything until `sendContract`. */
export async function createContract(
  ctx: TenantContext,
  input: CreateContractInput,
): Promise<ContractRow> {
  const template = await getContractTemplate(ctx, input.templateId);
  if (!template) throw new Error(`contract_template_not_found:${input.templateId}`);

  const contact = await getContact(ctx, input.contactId);
  if (!contact) throw new Error(`contact_not_found:${input.contactId}`);

  const renderedBody = renderContractBody(template.body, {
    contacto: {
      nombre: contact.name,
      telefono: contact.phone,
      email: contact.email ?? "",
      custom: contact.custom as Record<string, unknown> | null,
    },
  });

  const id = newId();
  const number = await nextDocumentNumber(ctx, "contrato");

  await tenantDb(ctx)
    .insert(contracts)
    .values({
      id,
      templateId: template.id,
      templateSnapshot: template.body,
      contactId: contact.id,
      dealId: input.dealId,
      quoteId: input.quoteId,
      number,
      renderedBody,
      status: "draft",
      publicToken: newPublicToken(),
    });

  return (await getContract(ctx, id))!;
}

export async function getContract(ctx: TenantContext, id: string): Promise<ContractRow | null> {
  const [row] = await tenantDb(ctx).select(contracts, eq(contracts.id, id));
  return row ?? null;
}

export async function listContracts(ctx: TenantContext): Promise<ContractRow[]> {
  const rows = await tenantDb(ctx).select(contracts);
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function listContractsForContact(
  ctx: TenantContext,
  contactId: string,
): Promise<ContractRow[]> {
  const rows = await tenantDb(ctx).select(contracts, eq(contracts.contactId, contactId));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Renders the contract PDF fresh from its stored (possibly frozen) body —
 *  used by the public PDF route and the "enviar por email" button, same
 *  on-demand-rather-than-served-from-storage rule as the quote/document
 *  PDFs (the stored copy `sendContract` writes is for the record, not for
 *  serving). */
export async function generateContractPdf(ctx: TenantContext, contractId: string): Promise<Buffer> {
  const contract = await getContract(ctx, contractId);
  if (!contract) throw new Error(`contract_not_found:${contractId}`);

  const [contact, tenant] = await Promise.all([
    getContact(ctx, contract.contactId),
    getTenant(ctx.tenantId),
  ]);
  if (!contact) throw new Error("contact_not_found");

  const settings = (tenant?.settings ?? {}) as TenantSettings;

  return renderContractPdf({
    number: contract.number,
    tenantName: tenant?.name ?? "",
    branding: settings.branding ?? {},
    locale: tenant?.locale,
    contactName: contact.name,
    contactPhone: contact.phone,
    createdAt: contract.createdAt,
    body: contract.renderedBody,
  });
}

export function publicContractUrl(token: string): string {
  return `${env.APP_URL}/c/${token}`;
}

export function publicContractPdfUrl(token: string): string {
  return `${env.APP_URL}/c/${token}/pdf`;
}

export type SendContractResult = {
  messageId: string | null;
  publicUrl: string;
  whatsappError?: string;
};

/**
 * Freezes the rendered body, renders and stores the PDF, delivers by
 * WhatsApp, and moves the contract to `sent`. The public token was already
 * minted at `createContract` — sending reuses it rather than rotating it,
 * so a link already copied out of the detail page keeps resolving.
 */
export async function sendContract(ctx: TenantContext, contractId: string): Promise<SendContractResult> {
  const contract = await getContract(ctx, contractId);
  if (!contract) throw new Error(`contract_not_found:${contractId}`);
  if (contract.status !== "draft") {
    throw new Error(`contract_not_draft:${contract.status}`);
  }

  const pdf = await generateContractPdf(ctx, contract.id);
  const stored = await storeDocumentPdf(ctx, { kind: "contracts", id: contract.id, pdf });

  await tenantDb(ctx)
    .update(contracts)
    .set({
      status: "sent",
      pdfStorageKey: stored.key,
      sentAt: new Date(),
    })
    .where(eq(contracts.id, contract.id));

  const url = publicContractUrl(contract.publicToken);
  const delivery = await sendDocumentOverWhatsapp(ctx, {
    contactId: contract.contactId,
    link: publicContractPdfUrl(contract.publicToken),
    filename: `${contract.number}.pdf`,
    caption: contract.number,
  });

  await createActivity(ctx, {
    contactId: contract.contactId,
    dealId: contract.dealId ?? undefined,
    type: "system",
    payload: {
      kind: "contract_sent",
      contractId: contract.id,
      number: contract.number,
      publicUrl: url,
      viaWhatsapp: delivery.messageId !== null,
      whatsappError: delivery.whatsappError,
    },
    userId: ctx.userId,
  });

  return { messageId: delivery.messageId, publicUrl: url, whatsappError: delivery.whatsappError };
}

/** Admin-only, audited (§4): a voided token stops resolving and the
 *  contract can no longer be decided. */
export async function voidContract(
  ctx: TenantContext,
  contractId: string,
  reason: string,
): Promise<ContractRow | null> {
  const contract = await getContract(ctx, contractId);
  if (!contract) throw new Error(`contract_not_found:${contractId}`);
  if (contract.status === "voided") return contract;

  await tenantDb(ctx)
    .update(contracts)
    .set({ status: "voided", voidedAt: new Date(), voidReason: reason.slice(0, 500) })
    .where(eq(contracts.id, contractId));

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    impersonatorUserId: ctx.impersonatorUserId,
    action: "contract.void",
    entity: "contract",
    entityId: contractId,
    payload: { number: contract.number, reason: reason.slice(0, 500) },
  });

  return getContract(ctx, contractId);
}

// --- Public lookup and acceptance ----------------------------------------

/** Unauthenticated read for /c/[token] — the token itself is the secret,
 *  same model as the quote and nota de venta links. A voided contract's link
 *  stops resolving. */
export async function getContractByPublicToken(token: string) {
  const [contract] = await db.select().from(contracts).where(eq(contracts.publicToken, token));
  if (!contract) return null;
  if (contract.status === "voided") return null;

  const ctx = await buildSystemTenantContext(contract.tenantId);
  if (!ctx) return null;

  const [acceptance] = await tenantDb(ctx).select(
    contractAcceptances,
    eq(contractAcceptances.contractId, contract.id),
  );

  return { contract, acceptance: acceptance ?? null, ctx };
}

export type ContractDecisionInput = {
  decision: "accepted" | "declined";
  nameTyped: string;
  ipAddress?: string;
  userAgent?: string;
  pdfBytes: Buffer;
};

export type ContractDecisionOutcome =
  | { ok: true; contract: ContractRow }
  | { ok: false; reason: "invalid" | "alreadyDecided" | "notSent" | "rateLimited" };

/**
 * Records the visitor's decision: the SHA-256 of the exact PDF bytes shown,
 * a re-rendered PDF with an appended acceptance page under a second storage
 * key (the original is never overwritten — its hash is the evidence), and
 * `contract.accepted` on acceptance so the automation trigger fires.
 */
export async function decideContract(
  token: string,
  input: ContractDecisionInput,
): Promise<ContractDecisionOutcome> {
  if (input.ipAddress) {
    const limit = await checkRateLimit(`contract-decision:${input.ipAddress}`, 10, 60_000);
    if (limit.limited) return { ok: false, reason: "rateLimited" };
  }

  const resolved = await getContractByPublicToken(token);
  if (!resolved) return { ok: false, reason: "invalid" };
  const { contract, ctx } = resolved;

  if (contract.status === "accepted" || contract.status === "declined") {
    return { ok: false, reason: "alreadyDecided" };
  }
  if (contract.status !== "sent") return { ok: false, reason: "notSent" };

  const pdfSha256 = createHash("sha256").update(input.pdfBytes).digest("hex");

  try {
    await tenantDb(ctx)
      .insert(contractAcceptances)
      .values({
        id: newId(),
        contractId: contract.id,
        nameTyped: input.nameTyped.slice(0, 200),
        decision: input.decision,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent?.slice(0, 500),
        pdfSha256,
      });
  } catch {
    // The unique index on contract_id is the real guard against a race (two
    // tabs deciding at once) — the status check above catches the common
    // case, this catches the rest.
    return { ok: false, reason: "alreadyDecided" };
  }

  const decidedAt = new Date();
  await tenantDb(ctx)
    .update(contracts)
    .set({ status: input.decision, decidedAt })
    .where(eq(contracts.id, contract.id));

  const [contact, tenant] = await Promise.all([
    getContact(ctx, contract.contactId),
    getTenant(ctx.tenantId),
  ]);
  const settings = (tenant?.settings ?? {}) as TenantSettings;

  const signedPdf = await renderContractPdf(
    {
      number: contract.number,
      tenantName: tenant?.name ?? "",
      branding: settings.branding ?? {},
      locale: tenant?.locale,
      contactName: contact?.name ?? "",
      contactPhone: contact?.phone ?? "",
      createdAt: contract.createdAt,
      body: contract.renderedBody,
    },
    {
      decision: input.decision,
      nameTyped: input.nameTyped,
      decidedAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  );
  const signedStored = await storeDocumentPdf(ctx, {
    kind: "contracts-signed",
    id: contract.id,
    pdf: signedPdf,
  });
  await tenantDb(ctx)
    .update(contracts)
    .set({ signedPdfStorageKey: signedStored.key })
    .where(eq(contracts.id, contract.id));

  await createActivity(ctx, {
    contactId: contract.contactId,
    dealId: contract.dealId ?? undefined,
    type: "system",
    payload: {
      kind: input.decision === "accepted" ? "contract_accepted" : "contract_declined",
      contractId: contract.id,
      number: contract.number,
      nameTyped: input.nameTyped,
    },
  });

  if (input.decision === "accepted") {
    await contractEvents.emit("contract.accepted", {
      tenantId: ctx.tenantId,
      contactId: contract.contactId,
      contractId: contract.id,
      dealId: contract.dealId ?? null,
      number: contract.number,
    });
  }

  return { ok: true, contract: (await getContract(ctx, contract.id))! };
}
