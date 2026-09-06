import {
  mysqlTable,
  char,
  varchar,
  boolean,
  datetime,
  index,
  uniqueIndex,
  text,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Contracts (PLAN.md §15.2, §17.2 P13). A non-fiscal document, same family as
// quotes and notas de venta — the `schema/documents.ts` boundary comment
// applies here unchanged: no timbrado, cdc, de_xml, or fiscal numbering.
// Acceptance is a *firma electrónica simple* under Ley 4017/2010, evidentiary
// rather than a certified *firma digital* (§17.1 #5) — click-to-accept only,
// which is why `contract_acceptances.signature_storage_key` exists but
// nothing writes to it yet.

export const contractTemplates = mysqlTable(
  "contract_templates",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    // Plain text with `#` headings and blank-line paragraphs, not Markdown or
    // HTML (§17.3 P13) — a tenant-authored body reaches a public page.
    body: text("body").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("contract_templates_tenant_id_idx").on(table.tenantId),
    index("contract_templates_tenant_active_idx").on(table.tenantId, table.isActive),
  ],
);

export const contracts = mysqlTable(
  "contracts",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    templateId: char("template_id", { length: 26 }).notNull(),
    // Frozen at creation so an edited template never rewrites a contract a
    // customer already holds a link to — same discipline as an issued nota
    // de venta.
    templateSnapshot: text("template_snapshot").notNull(),
    contactId: char("contact_id", { length: 26 }).notNull(),
    dealId: char("deal_id", { length: 26 }),
    quoteId: char("quote_id", { length: 26 }),
    // Per-tenant sequence — CON-000001 (document_sequences, doc_type "contrato").
    number: varchar("number", { length: 30 }).notNull(),
    renderedBody: text("rendered_body").notNull(),
    status: varchar("status", {
      length: 20,
      enum: ["draft", "sent", "accepted", "declined", "voided"],
    })
      .notNull()
      .default("draft"),
    // Unguessable token for the public page /c/[token] — stored in plaintext
    // like every sibling document's link (quotes.publicToken,
    // documents.publicToken, document_payments.receiptPublicToken): the
    // detail page needs a stable "copiar enlace" it can show on every reload,
    // which a hashed value could not be redisplayed for.
    publicToken: varchar("public_token", { length: 64 }).notNull(),
    pdfStorageKey: varchar("pdf_storage_key", { length: 500 }),
    // Re-rendered with an appended acceptance page after a decision — the
    // original key above is never overwritten, since its hash is the
    // evidence a visitor was shown exactly that document.
    signedPdfStorageKey: varchar("signed_pdf_storage_key", { length: 500 }),
    sentAt: datetime("sent_at"),
    decidedAt: datetime("decided_at"),
    voidedAt: datetime("voided_at"),
    voidReason: varchar("void_reason", { length: 500 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("contracts_tenant_id_idx").on(table.tenantId),
    index("contracts_tenant_contact_idx").on(table.tenantId, table.contactId),
    index("contracts_tenant_status_idx").on(table.tenantId, table.status),
    uniqueIndex("contracts_tenant_number_idx").on(table.tenantId, table.number),
    uniqueIndex("contracts_public_token_idx").on(table.publicToken),
  ],
);

/**
 * The acceptance/decline evidence record. Unique on `contract_id`: the index
 * is the real guard against a second decision (a caught insert conflict),
 * the status check in `modules/contracts/public.ts` is the cheaper,
 * clearer-error first line — same two-layer pattern as `quote_acceptances`.
 */
export const contractAcceptances = mysqlTable(
  "contract_acceptances",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    contractId: char("contract_id", { length: 26 }).notNull(),
    nameTyped: varchar("name_typed", { length: 200 }).notNull(),
    decision: varchar("decision", { length: 20, enum: ["accepted", "declined"] }).notNull(),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 500 }),
    pdfSha256: varchar("pdf_sha256", { length: 64 }).notNull(),
    // The drawn-signature column §17.1 #5 keeps for a later, additive
    // follow-up — click-to-accept ships nothing to it.
    signatureStorageKey: varchar("signature_storage_key", { length: 500 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("contract_acceptances_tenant_id_idx").on(table.tenantId),
    uniqueIndex("contract_acceptances_contract_id_idx").on(table.contractId),
  ],
);
