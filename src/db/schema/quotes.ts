import {
  mysqlTable,
  char,
  varchar,
  int,
  bigint,
  boolean,
  datetime,
  index,
  uniqueIndex,
  text,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Quotes / presupuestos (PLAN.md §4 "quotes", §8). Non-fiscal documents —
// deliberately kept separate from the future Phase 2 `invoices` tables,
// which have different immutability and numbering rules (§4).

export const products = mysqlTable(
  "products",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    // Integer minor units; PYG has 0 decimals so this is guaraníes as-is (§2.3).
    unitPrice: bigint("unit_price", { mode: "number" }).notNull().default(0),
    currency: char("currency", { length: 3 }).notNull().default("PYG"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("products_tenant_id_idx").on(table.tenantId)],
);

export const quotes = mysqlTable(
  "quotes",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    contactId: char("contact_id", { length: 26 }).notNull(),
    dealId: char("deal_id", { length: 26 }),
    // Per-tenant sequence, e.g. COT-000123 (§8).
    number: varchar("number", { length: 30 }).notNull(),
    status: varchar("status", {
      length: 20,
      enum: ["draft", "sent", "accepted", "rejected", "expired"],
    })
      .notNull()
      .default("draft"),
    currency: char("currency", { length: 3 }).notNull().default("PYG"),
    subtotal: bigint("subtotal", { mode: "number" }).notNull().default(0),
    discount: bigint("discount", { mode: "number" }).notNull().default(0),
    total: bigint("total", { mode: "number" }).notNull().default(0),
    validUntil: datetime("valid_until"),
    notes: text("notes"),
    // Unguessable token for the public read-only view /q/[token] (§8).
    publicToken: varchar("public_token", { length: 64 }).notNull(),
    pdfStorageKey: varchar("pdf_storage_key", { length: 500 }),
    sentAt: datetime("sent_at"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("quotes_tenant_id_idx").on(table.tenantId),
    index("quotes_tenant_contact_idx").on(table.tenantId, table.contactId),
    uniqueIndex("quotes_tenant_number_idx").on(table.tenantId, table.number),
    uniqueIndex("quotes_public_token_idx").on(table.publicToken),
  ],
);

export const quoteItems = mysqlTable(
  "quote_items",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    quoteId: char("quote_id", { length: 26 }).notNull(),
    // Null for free-text lines — the catalog is optional (§8).
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
    index("quote_items_tenant_id_idx").on(table.tenantId),
    index("quote_items_quote_id_idx").on(table.quoteId),
  ],
);

// Online accept/reject (PLAN.md §8, §15.5 J4b, §15.8 P6) — one row per
// decision. A quote can be decided exactly once (enforced in
// modules/quotes/public.ts, not here): the row is the evidence a rep can
// point to if a customer disputes having accepted.
export const quoteAcceptances = mysqlTable(
  "quote_acceptances",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    quoteId: char("quote_id", { length: 26 }).notNull(),
    decision: varchar("decision", { length: 10, enum: ["accepted", "rejected"] }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    comment: varchar("comment", { length: 1000 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 500 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("quote_acceptances_tenant_id_idx").on(table.tenantId),
    uniqueIndex("quote_acceptances_quote_id_idx").on(table.quoteId),
  ],
);

// One counter row per tenant, incremented inside a transaction so two quotes
// created at the same moment can never take the same number (§8).
export const quoteSequences = mysqlTable(
  "quote_sequences",
  {
    tenantId: char("tenant_id", { length: 26 }).primaryKey(),
    nextNumber: int("next_number").notNull().default(1),
    prefix: varchar("prefix", { length: 10 }).notNull().default("COT"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
);
