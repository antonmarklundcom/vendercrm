import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  like,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  bookingTypes,
  contacts,
  deals,
  forms,
  leadSubmissions,
  pipelines,
  sites,
  stages,
  tenants,
  users,
} from "@/db/schema";
import {
  buildLeadSubmissionView,
  toFieldValue,
  type LeadFieldSiteSettings,
  type LeadOrigin,
  type LeadSubmissionView,
} from "@/modules/leads/view";
import { writeAuditLog } from "./audit";
import type { SuperadminContext } from "./context";

// Leads, deals and contacts of every account in one list, for the superadmin
// (PLAN.md §19.4). A read-only window, not a new way to act across tenants:
//
// - Same shape as platform-stats.ts / console-sites.ts — raw `db`, because
//   there is no TenantContext to scope by. It never builds one: looping a
//   writable per-tenant context over every account just to read is exactly
//   the capability this view must not have. `tenantDb` gains no "all
//   tenants" mode and the lint allowlist does not grow.
// - Every export takes the SuperadminContext and re-checks it against the
//   users table before reading, so a forged context object reads nothing.
// - Every join between tenant-owned tables matches `tenant_id` as well as the
//   foreign key: a corrupted FK pointing into another account joins nothing.
// - The only write is one audit row per call (who looked, at what filter),
//   never the row data itself. A static test keeps this file free of any
//   other write.

/** Date presets in days (owner decision 2026-10-01). One edit to change them. */
export const PLATFORM_CRM_DATE_PRESETS = [1, 7, 30, 90, 180] as const;
export const PLATFORM_CRM_DEFAULT_DAYS = 30;
/** The widest custom from/to range; anything wider is clamped to its last 366 days. */
export const PLATFORM_CRM_MAX_CUSTOM_DAYS = 366;
export const PLATFORM_CRM_PAGE_SIZE = 50;
export const PLATFORM_CRM_MAX_PAGE = 200;
/** Search needs this many characters; shorter is ignored, not an error. */
export const PLATFORM_CRM_MIN_SEARCH = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const MESSAGE_PREVIEW = 120;
const FIELD_PREVIEW = 80;

export type PlatformCrmStatus = "open" | "won" | "lost";

/**
 * What the caller asks for, already typed. Every value is still validated
 * here (unknown values are dropped, never echoed into SQL): the page passes
 * whatever came in the URL.
 */
export type PlatformCrmFilters = {
  tenantIds?: string[];
  /** One of PLATFORM_CRM_DATE_PRESETS; anything else means the default. */
  days?: number;
  /** A custom range wins over `days` when both ends are valid dates. */
  from?: Date;
  to?: Date;
  status?: string;
  /** `site:<siteId>`, `form`, `booking` or `chat`. */
  source?: string;
  /** utm_source, prefix match. */
  utmSource?: string;
  /** Name / e-mail prefix, or phone digits. */
  q?: string;
};

/** The filters as applied, also what the audit row records. */
export type ResolvedPlatformCrmFilters = {
  tenantIds: string[];
  since: Date;
  until: Date;
  /** The preset in effect, or null for a custom range. */
  days: number | null;
  status: PlatformCrmStatus | null;
  source:
    | { kind: "site"; siteId: string }
    | { kind: "form" | "booking" | "chat" }
    | null;
  utmSource: string | null;
  q: string | null;
};

export type PlatformCrmPage<Row> = {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  filters: ResolvedPlatformCrmFilters;
};

const ID_PATTERN = /^[0-9A-Za-z]{26}$/;

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Date range per §19.4: valid custom range (capped), else a preset, else 30 days. */
export function resolvePlatformCrmRange(
  filters: Pick<PlatformCrmFilters, "days" | "from" | "to">,
  now: Date = new Date(),
): { since: Date; until: Date; days: number | null } {
  if (isValidDate(filters.from) && isValidDate(filters.to) && filters.from <= filters.to) {
    const earliest = new Date(filters.to.getTime() - PLATFORM_CRM_MAX_CUSTOM_DAYS * DAY_MS);
    return {
      since: filters.from < earliest ? earliest : filters.from,
      until: filters.to,
      days: null,
    };
  }
  const days = (PLATFORM_CRM_DATE_PRESETS as readonly number[]).includes(filters.days ?? NaN)
    ? (filters.days as number)
    : PLATFORM_CRM_DEFAULT_DAYS;
  return { since: new Date(now.getTime() - days * DAY_MS), until: now, days };
}

export function clampPlatformCrmPage(page: unknown): number {
  const value = typeof page === "number" ? page : Number(page);
  if (!Number.isInteger(value) || value < 1) return 1;
  return Math.min(value, PLATFORM_CRM_MAX_PAGE);
}

function resolveSource(value: string | undefined): ResolvedPlatformCrmFilters["source"] {
  if (value === "form" || value === "booking" || value === "chat") return { kind: value };
  if (value?.startsWith("site:")) {
    const siteId = value.slice("site:".length);
    if (ID_PATTERN.test(siteId)) return { kind: "site", siteId };
  }
  return null;
}

const trimmedOrNull = (value: string | undefined, max: number) => {
  const trimmed = value?.trim().slice(0, max);
  return trimmed ? trimmed : null;
};

async function resolveFilters(
  filters: PlatformCrmFilters,
  now: Date,
): Promise<ResolvedPlatformCrmFilters> {
  // Account ids are checked against the tenants table: an unknown id is
  // dropped, not an error, and never reaches the row queries.
  const requested = [...new Set((filters.tenantIds ?? []).filter((id) => ID_PATTERN.test(id)))];
  const tenantIds = requested.length
    ? (await db.select({ id: tenants.id }).from(tenants).where(inArray(tenants.id, requested))).map(
        (row) => row.id,
      )
    : [];

  const status =
    filters.status === "open" || filters.status === "won" || filters.status === "lost"
      ? filters.status
      : null;
  const q = trimmedOrNull(filters.q, 100);

  return {
    tenantIds,
    ...resolvePlatformCrmRange(filters, now),
    status,
    source: resolveSource(filters.source),
    utmSource: trimmedOrNull(filters.utmSource, 200),
    q: q && q.length >= PLATFORM_CRM_MIN_SEARCH ? q : null,
  };
}

/** Throws unless the context belongs to a user who is a superadmin right now. */
async function assertSuperadmin(sa: SuperadminContext): Promise<void> {
  if (!sa || typeof sa.userId !== "string" || sa.impersonatorUserId !== null) {
    throw new Error("Superadmin required");
  }
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, sa.userId), eq(users.isSuperadmin, true)))
    .limit(1);
  if (!row) throw new Error("Superadmin required");
}

async function auditView(
  sa: SuperadminContext,
  entity: "leads" | "deals" | "contacts",
  filters: ResolvedPlatformCrmFilters,
  page: number,
  rowCount: number,
  total: number,
) {
  await writeAuditLog({
    tenantId: filters.tenantIds.length === 1 ? filters.tenantIds[0] : null,
    actorUserId: sa.userId,
    action: "platform.crm.viewed",
    entity,
    entityId: entity,
    payload: {
      filters: {
        tenantIds: filters.tenantIds,
        since: filters.since.toISOString(),
        until: filters.until.toISOString(),
        days: filters.days,
        status: filters.status,
        source: filters.source,
        utmSource: filters.utmSource,
        q: filters.q,
      },
      page,
      rowCount,
      total,
    },
  });
}

/** `%` and `_` from the caller are literal characters, not wildcards. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
const prefix = (value: string) => `${escapeLike(value)}%`;

/** Phone digits as stored (E.164 without the leading zeros a local number has). */
function phoneDigits(q: string): string | null {
  if (!/^[\d\s+()-]+$/.test(q)) return null;
  const digits = q.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= PLATFORM_CRM_MIN_SEARCH ? digits : null;
}

/** Stage-derived status: `stages.is_won` / `is_lost`, since stage names differ per account. */
function statusCondition(status: PlatformCrmStatus): SQL {
  if (status === "won") return eq(stages.isWon, true);
  if (status === "lost") return eq(stages.isLost, true);
  return and(eq(stages.isWon, false), eq(stages.isLost, false))!;
}

function statusOf(stage: { isWon: boolean | null; isLost: boolean | null } | null) {
  if (!stage || stage.isWon === null) return null;
  if (stage.isWon) return "won" as const;
  if (stage.isLost) return "lost" as const;
  return "open" as const;
}

const leadChannel = sql<string | null>`json_unquote(json_extract(${leadSubmissions.payload}, '$.channel'))`;
const leadUtmSource = sql<string | null>`json_unquote(json_extract(${leadSubmissions.utm}, '$.source'))`;
const leadUtmCampaign = sql<string | null>`json_unquote(json_extract(${leadSubmissions.utm}, '$.campaign'))`;

/** Lead-submission conditions shared by the lead list and the deal/contact `EXISTS` filters. */
function submissionSourceConditions(filters: ResolvedPlatformCrmFilters): SQL[] {
  const where: SQL[] = [];
  const source = filters.source;
  if (source?.kind === "site") where.push(eq(leadSubmissions.siteId, source.siteId));
  if (source?.kind === "form") where.push(isNotNull(leadSubmissions.formId));
  if (source?.kind === "booking") where.push(isNotNull(leadSubmissions.bookingTypeId));
  if (source?.kind === "chat") where.push(sql`${leadChannel} = 'chat'`);
  if (filters.utmSource) where.push(like(leadUtmSource, prefix(filters.utmSource)));
  return where;
}

function contactSearch(q: string, extra: SQL[] = []): SQL {
  const digits = phoneDigits(q);
  const matches: SQL[] = [
    like(contacts.name, prefix(q)),
    like(contacts.email, prefix(q)),
    ...extra,
  ];
  if (digits) matches.push(like(contacts.phone, `%${escapeLike(digits)}%`));
  return or(...matches)!;
}

// ---------------------------------------------------------------------------
// Leads

const ORIGINAL_KEYS = new Set(["_original", "_original_cut"]);
const PREVIEW_SKIP = new Set([
  "name",
  "phone",
  "email",
  "message",
  "turnstile_token",
  "cf-turnstile-response",
  "_hp",
  "channel",
  "chatConversationId",
]);

/** The first two customer fields of a payload as plain text, for the list column. */
export function previewLeadFields(payload: unknown): Array<{ key: string; value: string }> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const preview: Array<{ key: string; value: string }> = [];
  for (const [key, raw] of Object.entries(payload as Record<string, unknown>)) {
    if (preview.length === 2) break;
    if (ORIGINAL_KEYS.has(key) || PREVIEW_SKIP.has(key)) continue;
    const value = toFieldValue(raw);
    const text =
      value.kind === "text" || value.kind === "json"
        ? value.text
        : value.kind === "list"
          ? value.items.join(", ")
          : value.kind === "bool"
            ? String(value.value)
            : null;
    if (text === null) continue;
    preview.push({ key, value: text.slice(0, FIELD_PREVIEW) });
  }
  return preview;
}

export type PlatformLeadRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  receivedAt: Date;
  needsReview: string[];
  origin: LeadOrigin;
  contactId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  /** First 120 characters. */
  message: string | null;
  fields: Array<{ key: string; value: string }>;
  utmSource: string | null;
  utmCampaign: string | null;
  dealId: string | null;
  dealStatus: PlatformCrmStatus | null;
  stageName: string | null;
};

function leadConditions(filters: ResolvedPlatformCrmFilters): SQL {
  const where: SQL[] = [
    gte(leadSubmissions.createdAt, filters.since),
    lte(leadSubmissions.createdAt, filters.until),
    ...submissionSourceConditions(filters),
  ];
  if (filters.tenantIds.length) where.push(inArray(leadSubmissions.tenantId, filters.tenantIds));
  if (filters.status) where.push(statusCondition(filters.status));
  if (filters.q) {
    where.push(
      contactSearch(filters.q, [
        like(leadSubmissions.submittedName, prefix(filters.q)),
        like(leadSubmissions.submittedEmail, prefix(filters.q)),
      ]),
    );
  }
  return and(...where)!;
}

export async function listPlatformLeads(
  sa: SuperadminContext,
  filters: PlatformCrmFilters = {},
  page: number = 1,
  now: Date = new Date(),
): Promise<PlatformCrmPage<PlatformLeadRow>> {
  await assertSuperadmin(sa);
  const resolved = await resolveFilters(filters, now);
  const currentPage = clampPlatformCrmPage(page);
  const where = leadConditions(resolved);

  // lead_submissions ⋈ tenants ⋈ contacts ⟕ sites ⟕ forms ⟕ booking_types ⟕
  // deals ⟕ stages, every tenant-owned join on tenant_id as well as the id.
  const base = () =>
    db
      .select({
        submission: {
          id: leadSubmissions.id,
          tenantId: leadSubmissions.tenantId,
          createdAt: leadSubmissions.createdAt,
          needsReview: leadSubmissions.needsReview,
          siteId: leadSubmissions.siteId,
          formId: leadSubmissions.formId,
          bookingTypeId: leadSubmissions.bookingTypeId,
          contactId: leadSubmissions.contactId,
          dealId: leadSubmissions.dealId,
          payload: leadSubmissions.payload,
          submittedName: leadSubmissions.submittedName,
          submittedEmail: leadSubmissions.submittedEmail,
          submittedPhone: leadSubmissions.submittedPhone,
          message: sql<string | null>`left(${leadSubmissions.notes}, ${MESSAGE_PREVIEW})`,
          utmSource: leadUtmSource,
          utmCampaign: leadUtmCampaign,
          channel: leadChannel,
        },
        tenant: { name: tenants.name, status: tenants.status },
        contact: { name: contacts.name, phone: contacts.phone, email: contacts.email },
        site: { name: sites.name, domain: sites.domain },
        formName: forms.name,
        bookingTypeName: bookingTypes.name,
        stage: { name: stages.name, isWon: stages.isWon, isLost: stages.isLost },
      })
      .from(leadSubmissions)
      .innerJoin(tenants, eq(tenants.id, leadSubmissions.tenantId))
      .innerJoin(
        contacts,
        and(eq(contacts.tenantId, leadSubmissions.tenantId), eq(contacts.id, leadSubmissions.contactId)),
      )
      .leftJoin(
        sites,
        and(eq(sites.tenantId, leadSubmissions.tenantId), eq(sites.id, leadSubmissions.siteId)),
      )
      .leftJoin(
        forms,
        and(eq(forms.tenantId, leadSubmissions.tenantId), eq(forms.id, leadSubmissions.formId)),
      )
      .leftJoin(
        bookingTypes,
        and(
          eq(bookingTypes.tenantId, leadSubmissions.tenantId),
          eq(bookingTypes.id, leadSubmissions.bookingTypeId),
        ),
      )
      .leftJoin(
        deals,
        and(eq(deals.tenantId, leadSubmissions.tenantId), eq(deals.id, leadSubmissions.dealId)),
      )
      .leftJoin(stages, and(eq(stages.tenantId, deals.tenantId), eq(stages.id, deals.stageId)));

  const [rows, [{ value: total }]] = await Promise.all([
    base()
      .where(where)
      .orderBy(desc(leadSubmissions.createdAt), desc(leadSubmissions.id))
      .limit(PLATFORM_CRM_PAGE_SIZE)
      .offset((currentPage - 1) * PLATFORM_CRM_PAGE_SIZE),
    db
      .select({ value: count() })
      .from(leadSubmissions)
      .innerJoin(
        contacts,
        and(eq(contacts.tenantId, leadSubmissions.tenantId), eq(contacts.id, leadSubmissions.contactId)),
      )
      .leftJoin(
        deals,
        and(eq(deals.tenantId, leadSubmissions.tenantId), eq(deals.id, leadSubmissions.dealId)),
      )
      .leftJoin(stages, and(eq(stages.tenantId, deals.tenantId), eq(stages.id, deals.stageId)))
      .where(where),
  ]);

  const result: PlatformLeadRow[] = rows.map((row) => {
    const s = row.submission;
    const origin: LeadOrigin = s.formId
      ? { kind: "form", name: row.formName ?? null, domain: null }
      : s.bookingTypeId
        ? { kind: "booking", name: row.bookingTypeName ?? null, domain: null }
        : {
            kind: s.channel === "chat" ? "chat" : "site",
            name: row.site?.name ?? null,
            domain: row.site?.domain ?? null,
          };
    return {
      id: s.id,
      tenantId: s.tenantId,
      tenantName: row.tenant.name,
      tenantStatus: row.tenant.status,
      receivedAt: s.createdAt,
      needsReview: Array.isArray(s.needsReview) ? s.needsReview : [],
      origin,
      contactId: s.contactId,
      name: s.submittedName ?? row.contact.name,
      phone: s.submittedPhone ?? row.contact.phone,
      email: s.submittedEmail ?? row.contact.email,
      message: s.message,
      fields: previewLeadFields(s.payload),
      utmSource: s.utmSource,
      utmCampaign: s.utmCampaign,
      dealId: s.dealId,
      dealStatus: statusOf(row.stage),
      stageName: row.stage?.name ?? null,
    };
  });

  await auditView(sa, "leads", resolved, currentPage, result.length, Number(total));
  return {
    rows: result,
    total: Number(total),
    page: currentPage,
    pageSize: PLATFORM_CRM_PAGE_SIZE,
    filters: resolved,
  };
}

// ---------------------------------------------------------------------------
// Deals

export type PlatformDealRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  createdAt: Date;
  title: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  pipelineName: string;
  stageName: string;
  status: PlatformCrmStatus;
  /** Per currency; never summed across currencies. */
  value: number;
  currency: string;
  ownerName: string | null;
  /** From the deal's first lead submission, when it came from one. */
  source: string | null;
  siteName: string | null;
  siteDomain: string | null;
  stageEnteredAt: Date;
};

/** `EXISTS` a lead submission of this deal (same tenant) matching the source filters. */
function dealSubmissionExists(conditions: SQL[]): SQL {
  return sql`exists (select 1 from ${leadSubmissions} where ${leadSubmissions.tenantId} = ${deals.tenantId} and ${leadSubmissions.dealId} = ${deals.id} and ${and(...conditions)})`;
}

function dealConditions(filters: ResolvedPlatformCrmFilters): SQL {
  const where: SQL[] = [gte(deals.createdAt, filters.since), lte(deals.createdAt, filters.until)];
  if (filters.tenantIds.length) where.push(inArray(deals.tenantId, filters.tenantIds));
  if (filters.status) where.push(statusCondition(filters.status));
  const source = submissionSourceConditions(filters);
  if (source.length) where.push(dealSubmissionExists(source));
  if (filters.q) where.push(or(like(deals.title, prefix(filters.q)), contactSearch(filters.q))!);
  return and(...where)!;
}

export async function listPlatformDeals(
  sa: SuperadminContext,
  filters: PlatformCrmFilters = {},
  page: number = 1,
  now: Date = new Date(),
): Promise<PlatformCrmPage<PlatformDealRow>> {
  await assertSuperadmin(sa);
  const resolved = await resolveFilters(filters, now);
  const currentPage = clampPlatformCrmPage(page);
  const where = dealConditions(resolved);

  // deals ⋈ tenants ⋈ contacts ⋈ stages ⋈ pipelines ⟕ users (owner), every
  // tenant-owned join on tenant_id as well as the id.
  const contactJoin = and(eq(contacts.tenantId, deals.tenantId), eq(contacts.id, deals.contactId));
  const stageJoin = and(eq(stages.tenantId, deals.tenantId), eq(stages.id, deals.stageId));
  const pipelineJoin = and(eq(pipelines.tenantId, deals.tenantId), eq(pipelines.id, deals.pipelineId));

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        deal: deals,
        tenant: { name: tenants.name, status: tenants.status },
        contact: { name: contacts.name, phone: contacts.phone },
        stage: { name: stages.name, isWon: stages.isWon, isLost: stages.isLost },
        pipelineName: pipelines.name,
        ownerName: users.name,
      })
      .from(deals)
      .innerJoin(tenants, eq(tenants.id, deals.tenantId))
      .innerJoin(contacts, contactJoin)
      .innerJoin(stages, stageJoin)
      .innerJoin(pipelines, pipelineJoin)
      // Users are platform-wide, not tenant-owned: the id is the whole key.
      .leftJoin(users, eq(users.id, deals.assignedUserId))
      .where(where)
      .orderBy(desc(deals.createdAt), desc(deals.id))
      .limit(PLATFORM_CRM_PAGE_SIZE)
      .offset((currentPage - 1) * PLATFORM_CRM_PAGE_SIZE),
    db
      .select({ value: count() })
      .from(deals)
      .innerJoin(tenants, eq(tenants.id, deals.tenantId))
      .innerJoin(contacts, contactJoin)
      .innerJoin(stages, stageJoin)
      .innerJoin(pipelines, pipelineJoin)
      .where(where),
  ]);

  // The deal's first lead submission (site, source), read for this page only
  // and matched on tenant and deal id both.
  const firstSubmission = new Map<string, { source: string | null; siteName: string | null; siteDomain: string | null }>();
  if (rows.length) {
    const submissions = await db
      .select({
        tenantId: leadSubmissions.tenantId,
        dealId: leadSubmissions.dealId,
        source: leadSubmissions.source,
        siteName: sites.name,
        siteDomain: sites.domain,
      })
      .from(leadSubmissions)
      .leftJoin(
        sites,
        and(eq(sites.tenantId, leadSubmissions.tenantId), eq(sites.id, leadSubmissions.siteId)),
      )
      .where(
        and(
          inArray(leadSubmissions.tenantId, [...new Set(rows.map((row) => row.deal.tenantId))]),
          inArray(leadSubmissions.dealId, rows.map((row) => row.deal.id)),
        ),
      )
      .orderBy(leadSubmissions.createdAt, leadSubmissions.id);
    for (const submission of submissions) {
      const key = `${submission.tenantId}:${submission.dealId}`;
      if (!firstSubmission.has(key)) {
        firstSubmission.set(key, {
          source: submission.source,
          siteName: submission.siteName,
          siteDomain: submission.siteDomain,
        });
      }
    }
  }

  const result: PlatformDealRow[] = rows.map((row) => {
    const first = firstSubmission.get(`${row.deal.tenantId}:${row.deal.id}`);
    return {
      id: row.deal.id,
      tenantId: row.deal.tenantId,
      tenantName: row.tenant.name,
      tenantStatus: row.tenant.status,
      createdAt: row.deal.createdAt,
      title: row.deal.title,
      contactId: row.deal.contactId,
      contactName: row.contact.name,
      contactPhone: row.contact.phone,
      pipelineName: row.pipelineName,
      stageName: row.stage.name,
      status: statusOf(row.stage) ?? "open",
      value: row.deal.value,
      currency: row.deal.currency,
      ownerName: row.ownerName ?? null,
      source: first?.source ?? null,
      siteName: first?.siteName ?? null,
      siteDomain: first?.siteDomain ?? null,
      stageEnteredAt: row.deal.stageEnteredAt,
    };
  });

  await auditView(sa, "deals", resolved, currentPage, result.length, Number(total));
  return {
    rows: result,
    total: Number(total),
    page: currentPage,
    pageSize: PLATFORM_CRM_PAGE_SIZE,
    filters: resolved,
  };
}

// ---------------------------------------------------------------------------
// Contacts

export type PlatformContactRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  createdAt: Date;
  name: string;
  phone: string;
  email: string | null;
  source: string | null;
  firstSiteName: string | null;
  firstSiteDomain: string | null;
  openDeals: number;
};

function contactConditions(filters: ResolvedPlatformCrmFilters): SQL {
  const where: SQL[] = [
    gte(contacts.createdAt, filters.since),
    lte(contacts.createdAt, filters.until),
  ];
  if (filters.tenantIds.length) where.push(inArray(contacts.tenantId, filters.tenantIds));
  if (filters.status) {
    // A contact matches when it has a deal in that state, in its own account.
    where.push(
      sql`exists (select 1 from ${deals} inner join ${stages} on ${stages.tenantId} = ${deals.tenantId} and ${stages.id} = ${deals.stageId} where ${deals.tenantId} = ${contacts.tenantId} and ${deals.contactId} = ${contacts.id} and ${statusCondition(filters.status)})`,
    );
  }
  const source = submissionSourceConditions(filters);
  if (source.length) {
    where.push(
      sql`exists (select 1 from ${leadSubmissions} where ${leadSubmissions.tenantId} = ${contacts.tenantId} and ${leadSubmissions.contactId} = ${contacts.id} and ${and(...source)})`,
    );
  }
  if (filters.q) where.push(contactSearch(filters.q));
  return and(...where)!;
}

export async function listPlatformContacts(
  sa: SuperadminContext,
  filters: PlatformCrmFilters = {},
  page: number = 1,
  now: Date = new Date(),
): Promise<PlatformCrmPage<PlatformContactRow>> {
  await assertSuperadmin(sa);
  const resolved = await resolveFilters(filters, now);
  const currentPage = clampPlatformCrmPage(page);
  const where = contactConditions(resolved);

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        contact: {
          id: contacts.id,
          tenantId: contacts.tenantId,
          createdAt: contacts.createdAt,
          name: contacts.name,
          phone: contacts.phone,
          email: contacts.email,
          source: contacts.source,
        },
        tenant: { name: tenants.name, status: tenants.status },
        site: { name: sites.name, domain: sites.domain },
      })
      .from(contacts)
      .innerJoin(tenants, eq(tenants.id, contacts.tenantId))
      .leftJoin(sites, and(eq(sites.tenantId, contacts.tenantId), eq(sites.id, contacts.firstSiteId)))
      .where(where)
      .orderBy(desc(contacts.createdAt), desc(contacts.id))
      .limit(PLATFORM_CRM_PAGE_SIZE)
      .offset((currentPage - 1) * PLATFORM_CRM_PAGE_SIZE),
    db.select({ value: count() }).from(contacts).where(where),
  ]);

  const openDeals = new Map<string, number>();
  if (rows.length) {
    const counts = await db
      .select({ tenantId: deals.tenantId, contactId: deals.contactId, value: count() })
      .from(deals)
      .innerJoin(stages, and(eq(stages.tenantId, deals.tenantId), eq(stages.id, deals.stageId)))
      .where(
        and(
          inArray(deals.tenantId, [...new Set(rows.map((row) => row.contact.tenantId))]),
          inArray(deals.contactId, rows.map((row) => row.contact.id)),
          statusCondition("open"),
        ),
      )
      .groupBy(deals.tenantId, deals.contactId);
    for (const row of counts) openDeals.set(`${row.tenantId}:${row.contactId}`, Number(row.value));
  }

  const result: PlatformContactRow[] = rows.map((row) => ({
    id: row.contact.id,
    tenantId: row.contact.tenantId,
    tenantName: row.tenant.name,
    tenantStatus: row.tenant.status,
    createdAt: row.contact.createdAt,
    name: row.contact.name,
    phone: row.contact.phone,
    email: row.contact.email,
    source: row.contact.source,
    firstSiteName: row.site?.name ?? null,
    firstSiteDomain: row.site?.domain ?? null,
    openDeals: openDeals.get(`${row.contact.tenantId}:${row.contact.id}`) ?? 0,
  }));

  await auditView(sa, "contacts", resolved, currentPage, result.length, Number(total));
  return {
    rows: result,
    total: Number(total),
    page: currentPage,
    pageSize: PLATFORM_CRM_PAGE_SIZE,
    filters: resolved,
  };
}

// ---------------------------------------------------------------------------
// One deal, read-only, with its form data

export type PlatformDealDetail = PlatformDealRow & {
  contactEmail: string | null;
  closedAt: Date | null;
  /** The deal's submissions, newest first, as the same view-model the tenant app renders. */
  leads: LeadSubmissionView[];
};

/**
 * `WHERE deals.tenant_id = ? AND deals.id = ?` with every join tenant-matched,
 * so a mismatched (tenantId, dealId) pair is null — never another account's
 * row, and indistinguishable from an id that does not exist.
 */
export async function getPlatformDeal(
  sa: SuperadminContext,
  tenantId: string,
  dealId: string,
  /** The i18n dictionary of common form keys (`app.leadData.fieldNames`). */
  fieldNames: Record<string, string> = {},
): Promise<PlatformDealDetail | null> {
  await assertSuperadmin(sa);
  const detail =
    ID_PATTERN.test(tenantId) && ID_PATTERN.test(dealId)
      ? await readPlatformDeal(tenantId, dealId, fieldNames)
      : null;

  await writeAuditLog({
    tenantId: detail ? tenantId : null,
    actorUserId: sa.userId,
    action: "platform.deal.viewed",
    entity: "deal",
    entityId: dealId.slice(0, 26),
    payload: { found: !!detail },
  });
  return detail;
}

async function readPlatformDeal(
  tenantId: string,
  dealId: string,
  fieldNames: Record<string, string>,
): Promise<PlatformDealDetail | null> {
  const [row] = await db
    .select({
      deal: deals,
      tenant: { name: tenants.name, status: tenants.status },
      contact: { name: contacts.name, phone: contacts.phone, email: contacts.email },
      stage: { name: stages.name, isWon: stages.isWon, isLost: stages.isLost },
      pipelineName: pipelines.name,
      ownerName: users.name,
    })
    .from(deals)
    .innerJoin(tenants, eq(tenants.id, deals.tenantId))
    .innerJoin(contacts, and(eq(contacts.tenantId, deals.tenantId), eq(contacts.id, deals.contactId)))
    .innerJoin(stages, and(eq(stages.tenantId, deals.tenantId), eq(stages.id, deals.stageId)))
    .innerJoin(pipelines, and(eq(pipelines.tenantId, deals.tenantId), eq(pipelines.id, deals.pipelineId)))
    .leftJoin(users, eq(users.id, deals.assignedUserId))
    .where(and(eq(deals.tenantId, tenantId), eq(deals.id, dealId)))
    .limit(1);
  if (!row) return null;

  const submissions = await db
    .select({
      submission: leadSubmissions,
      site: { name: sites.name, domain: sites.domain, settings: sites.settings },
      form: { name: forms.name, fields: forms.fields },
      bookingTypeName: bookingTypes.name,
    })
    .from(leadSubmissions)
    .leftJoin(sites, and(eq(sites.tenantId, leadSubmissions.tenantId), eq(sites.id, leadSubmissions.siteId)))
    .leftJoin(forms, and(eq(forms.tenantId, leadSubmissions.tenantId), eq(forms.id, leadSubmissions.formId)))
    .leftJoin(
      bookingTypes,
      and(
        eq(bookingTypes.tenantId, leadSubmissions.tenantId),
        eq(bookingTypes.id, leadSubmissions.bookingTypeId),
      ),
    )
    .where(and(eq(leadSubmissions.tenantId, tenantId), eq(leadSubmissions.dealId, dealId)))
    .orderBy(desc(leadSubmissions.createdAt), desc(leadSubmissions.id));

  const contact = { name: row.contact.name, email: row.contact.email, phone: row.contact.phone };
  const leads = submissions.map(({ submission, site, form, bookingTypeName }) => {
    const payload = (submission.payload ?? {}) as Record<string, unknown>;
    const origin: LeadOrigin = submission.formId
      ? { kind: "form", name: form?.name ?? null, domain: null }
      : submission.bookingTypeId
        ? { kind: "booking", name: bookingTypeName ?? null, domain: null }
        : {
            kind: payload.channel === "chat" ? "chat" : "site",
            name: site?.name ?? null,
            domain: site?.domain ?? null,
          };
    const formLabels: Record<string, string> = {};
    for (const field of (form?.fields ?? []) as Array<{ key?: string; label?: string }>) {
      if (field.key && field.label) formLabels[field.key] = field.label;
    }
    return buildLeadSubmissionView(submission, {
      origin,
      contact,
      formLabels,
      siteSettings: (site?.settings ?? {}) as LeadFieldSiteSettings,
      fieldNames,
    });
  });

  const first = submissions.at(-1);
  return {
    id: row.deal.id,
    tenantId: row.deal.tenantId,
    tenantName: row.tenant.name,
    tenantStatus: row.tenant.status,
    createdAt: row.deal.createdAt,
    title: row.deal.title,
    contactId: row.deal.contactId,
    contactName: row.contact.name,
    contactPhone: row.contact.phone,
    contactEmail: row.contact.email,
    pipelineName: row.pipelineName,
    stageName: row.stage.name,
    status: statusOf(row.stage) ?? "open",
    value: row.deal.value,
    currency: row.deal.currency,
    ownerName: row.ownerName ?? null,
    source: first?.submission.source ?? null,
    siteName: first?.site?.name ?? null,
    siteDomain: first?.site?.domain ?? null,
    stageEnteredAt: row.deal.stageEnteredAt,
    closedAt: row.deal.closedAt,
    leads,
  };
}
