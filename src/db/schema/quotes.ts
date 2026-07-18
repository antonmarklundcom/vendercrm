import {
  mysqlTable,
  char,
  varchar,
  bigint,
  int,
  boolean,
  text,
  datetime,
  index,
  unique,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenancy";
import { contacts, deals } from "./crm";

// Quotes / presupuestos (PLAN.md §4, §8). Non-fiscal — no SIFEN dependency in
// Phase 1. Kept as separate tables from the future Phase 2 `invoices` (fiscal
// docs have different immutability/numbering rules); a Phase 2 invoice can
// reference a quote.

export const products = mysqlTable(
  "products",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    unitPrice: bigint("unit_price", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("PYG"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("products_tenant_idx").on(t.tenantId)],
);

export const quotes = mysqlTable(
  "quotes",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: char("contact_id", { length: 26 })
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    dealId: char("deal_id", { length: 26 }).references(() => deals.id, {
      onDelete: "set null",
    }),
    // Per-tenant sequential display number, e.g. "COT-000123".
    number: varchar("number", { length: 32 }).notNull(),
    status: varchar("status", {
      length: 16,
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
    // Bearer token for the unauthenticated public read-only view /q/[token].
    publicToken: varchar("public_token", { length: 64 }).notNull(),
    pdfStorageKey: varchar("pdf_storage_key", { length: 255 }),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("quotes_tenant_idx").on(t.tenantId),
    index("quotes_contact_idx").on(t.contactId),
    unique("quotes_tenant_number_uq").on(t.tenantId, t.number),
    unique("quotes_public_token_uq").on(t.publicToken),
  ],
);

export const quoteItems = mysqlTable(
  "quote_items",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    quoteId: char("quote_id", { length: 26 })
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    productId: char("product_id", { length: 26 }).references(() => products.id, {
      onDelete: "set null",
    }),
    description: varchar("description", { length: 500 }).notNull(),
    qty: int("qty").notNull().default(1),
    unitPrice: bigint("unit_price", { mode: "number" }).notNull(),
    lineTotal: bigint("line_total", { mode: "number" }).notNull(),
    position: int("position").notNull().default(0),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("quote_items_tenant_idx").on(t.tenantId),
    index("quote_items_quote_idx").on(t.quoteId),
  ],
);

// Per-tenant counter row, incremented in a transaction (PLAN.md §8).
export const quoteSequences = mysqlTable(
  "quote_sequences",
  {
    tenantId: char("tenant_id", { length: 26 })
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    nextNumber: int("next_number").notNull().default(1),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);
