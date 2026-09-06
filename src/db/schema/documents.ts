import {
  mysqlTable,
  char,
  varchar,
  int,
  bigint,
  datetime,
  index,
  uniqueIndex,
  text,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Non-fiscal commercial documents — "notas de venta" (PLAN.md §10 1Q).
//
// ⚠️ BOUNDARY RULE, load-bearing for Phase 2. These are **not** facturas and
// must never become them. In Paraguay a factura is a fiscal document
// requiring timbrado and SIFEN clearance; a PDF that looks like one but
// isn't is not a valid tax document. Phase 2's fiscal invoices get their own
// tables per §4/§9 and are NOT a status or a type on this table. A
// `nota_venta` may later be *referenced by* a fiscal invoice
// (`invoices.document_id`), exactly as §4 already allows for quotes.
//
// Never add `timbrado`, `cdc`, `de_xml`, establishment/point-of-sale codes,
// or fiscal numbering ranges to these tables. If a field only makes sense
// for a SIFEN document, it belongs in Phase 2's tables, not here.
//
// Separate from `quotes` for the same reason quotes are separate from
// invoices: a quote is an offer that may change, a nota de venta is a record
// of an agreed sale that must not (see `status`).

export const documents = mysqlTable(
  "documents",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    /**
     * Varchar rather than a MySQL ENUM so new non-fiscal document kinds can
     * be added without a migration. Only `nota_venta` ships in 1Q. A recibo
     * (§15.8 P6) is *not* a second value here — it renders straight off one
     * `document_payments` row (receiptNumber/receiptPublicToken on that
     * table) rather than getting its own `documents` row, since it has no
     * items, quote link or payment ledger of its own to carry.
     */
    type: varchar("type", { length: 20, enum: ["nota_venta"] })
      .notNull()
      .default("nota_venta"),
    // Per-tenant, per-type sequence — e.g. NV-000001 (see document_sequences).
    number: varchar("number", { length: 30 }).notNull(),
    contactId: char("contact_id", { length: 26 }).notNull(),
    dealId: char("deal_id", { length: 26 }),
    /** Set when the document was created by converting a quote. */
    quoteId: char("quote_id", { length: 26 }),
    /**
     * Lifecycle only. Payment state (paid / partially paid / unpaid) is
     * **derived** by summing document_payments, never stored here — a
     * denormalized paid-amount column is the classic source of drift
     * between the ledger and the header.
     *
     * `issued` is the immutability line: past it, lines, totals and number
     * are frozen (enforced in modules/documents/documents.ts). `void` is
     * the only escape, and only while no payments are recorded.
     */
    status: varchar("status", { length: 20, enum: ["draft", "issued", "void"] })
      .notNull()
      .default("draft"),
    currency: char("currency", { length: 3 }).notNull().default("PYG"),
    // Integer minor units; PYG has 0 decimals so this is guaraníes as-is (§2.3).
    subtotal: bigint("subtotal", { mode: "number" }).notNull().default(0),
    discount: bigint("discount", { mode: "number" }).notNull().default(0),
    total: bigint("total", { mode: "number" }).notNull().default(0),
    issuedAt: datetime("issued_at"),
    dueAt: datetime("due_at"),
    notes: text("notes"),
    // Unguessable token for the public read-only view /d/[token], same model
    // as the quote link (§8).
    publicToken: varchar("public_token", { length: 64 }).notNull(),
    pdfStorageKey: varchar("pdf_storage_key", { length: 500 }),
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
    index("documents_tenant_id_idx").on(table.tenantId),
    index("documents_tenant_contact_idx").on(table.tenantId, table.contactId),
    index("documents_tenant_status_idx").on(table.tenantId, table.status),
    uniqueIndex("documents_tenant_number_idx").on(table.tenantId, table.number),
    uniqueIndex("documents_public_token_idx").on(table.publicToken),
  ],
);

export const documentItems = mysqlTable(
  "document_items",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    documentId: char("document_id", { length: 26 }).notNull(),
    // Null for free-text lines — the catalog is optional, same as quotes.
    productId: char("product_id", { length: 26 }),
    description: varchar("description", { length: 500 }).notNull(),
    qty: int("qty").notNull().default(1),
    unitPrice: bigint("unit_price", { mode: "number" }).notNull().default(0),
    lineTotal: bigint("line_total", { mode: "number" }).notNull().default(0),
    position: int("position").notNull().default(0),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("document_items_tenant_id_idx").on(table.tenantId),
    index("document_items_document_id_idx").on(table.documentId),
  ],
);

/**
 * The payment ledger. Append-mostly: the sum of these rows *is* the amount
 * paid, which is why the header carries no paid-amount column. A correction
 * is a deletion by a user who can see the row, not a silent header edit.
 */
export const documentPayments = mysqlTable(
  "document_payments",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    documentId: char("document_id", { length: 26 }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull().default(0),
    currency: char("currency", { length: 3 }).notNull().default("PYG"),
    method: varchar("method", {
      length: 20,
      enum: ["transfer", "cash", "card", "check", "other"],
    })
      .notNull()
      .default("cash"),
    reference: varchar("reference", { length: 200 }),
    paidAt: datetime("paid_at").notNull(),
    recordedByUserId: char("recorded_by_user_id", { length: 26 }),
    notes: varchar("notes", { length: 500 }),
    /**
     * The receipt (§15.2, §15.8 P6) is generated lazily, the first time
     * anyone asks for it — not at payment time, so a payment nobody ever
     * requests a receipt for never consumes a `document_sequences` number.
     * Both are null until that first request.
     */
    receiptNumber: varchar("receipt_number", { length: 30 }),
    receiptPublicToken: varchar("receipt_public_token", { length: 64 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("document_payments_tenant_id_idx").on(table.tenantId),
    index("document_payments_document_id_idx").on(table.documentId),
    uniqueIndex("document_payments_receipt_token_idx").on(table.receiptPublicToken),
  ],
);

/**
 * One counter row per (tenant, document type), incremented inside a
 * transaction — same discipline as quote_sequences (§8).
 *
 * A deliberately separate table rather than a `type` column bolted onto
 * quote_sequences: that table is live in production and numbers documents
 * customers have already received. Generalizing it in place would put
 * existing quote numbering at risk to save one table, which is a bad trade.
 */
export const documentSequences = mysqlTable(
  "document_sequences",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    docType: varchar("doc_type", { length: 20 }).notNull(),
    prefix: varchar("prefix", { length: 10 }).notNull().default("NV"),
    nextNumber: int("next_number").notNull().default(1),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("document_sequences_tenant_type_idx").on(table.tenantId, table.docType),
  ],
);
