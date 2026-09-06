import {
  mysqlTable,
  char,
  varchar,
  json,
  datetime,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// Per-tenant email identity (PLAN.md §15.1, §15.8 P4). Every tenant sends
// through the platform's one Resend account (§15.1's decision) — a verified
// domain here only changes what `senderFor(ctx)` puts in the `From` header,
// never which API key signs the request.

export const tenantEmailDomains = mysqlTable(
  "tenant_email_domains",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    // Null until Resend is configured (RESEND_API_KEY unset) or the create
    // call hasn't run yet.
    resendDomainId: varchar("resend_domain_id", { length: 100 }),
    status: varchar("status", { length: 20, enum: ["pending", "verified", "failed"] })
      .notNull()
      .default("pending"),
    // Whatever Resend's domains.create/get returned for `records` — rendered
    // generically in the settings UI rather than typed field-by-field, since
    // the SDK's own DomainRecords union already carries the shape.
    dnsRecords: json("dns_records").notNull().default([]),
    verifiedAt: datetime("verified_at"),
    // The local part of the tenant's own address, e.g. "ventas" for
    // ventas@cliente.com.py. Defaults to the default tier's mailbox name if
    // unset once verified.
    fromLocalPart: varchar("from_local_part", { length: 64 }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("tenant_email_domains_tenant_id_idx").on(table.tenantId),
    index("tenant_email_domains_status_idx").on(table.status),
  ],
);

// One row per send attempt (PLAN.md §15.1). Backs the `maxEmailsPerDay` plan
// cap (modules/tenancy/limits.ts) and gives an admin something to point at
// when "did the email actually go out" comes up.
export const emailLog = mysqlTable(
  "email_log",
  {
    id: char("id", { length: 26 }).primaryKey(),
    tenantId: char("tenant_id", { length: 26 }).notNull(),
    to: varchar("to", { length: 320 }).notNull(),
    subject: varchar("subject", { length: 500 }).notNull(),
    kind: varchar("kind", { length: 20, enum: ["transactional", "automated"] }).notNull(),
    // Resend's email id, when the send reached the API at all.
    providerId: varchar("provider_id", { length: 100 }),
    status: varchar("status", { length: 20, enum: ["sent", "failed", "skipped"] }).notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("email_log_tenant_id_idx").on(table.tenantId),
    index("email_log_tenant_created_idx").on(table.tenantId, table.createdAt),
  ],
);
