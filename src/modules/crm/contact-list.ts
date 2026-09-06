import { and, asc, desc, eq, gte, inArray, like, lte, or, sql, type SQL } from "drizzle-orm";
import { contactTags, contacts, deals, stages } from "@/db/schema";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import type { ListContactsFilters } from "./contacts";

// The contacts list as a real table (PLAN.md §10 1J #1): sorting, the filters
// a rep actually reaches for, and pagination — moved into SQL in §15.8 P5
// (sort/LIMIT/OFFSET/COUNT all run in MySQL now; only the filters that need
// a join — tags, pipeline/stage, custom fields — resolve their matching
// contact ids with one extra scoped read first, then narrow the main query
// with `inArray` rather than a second in-memory pass). One shape serves both
// the screen and the CSV export, so "exportar" always means "what this list
// is showing" — the property that makes an export trustworthy.

export const CONTACT_SORT_FIELDS = ["name", "createdAt", "phone"] as const;
export type ContactSortField = (typeof CONTACT_SORT_FIELDS)[number];
export type SortDirection = "asc" | "desc";

export type CustomFieldOperator = "equals" | "contains";

export type ContactQuery = ListContactsFilters & {
  /** Only contacts with a deal in a stage that is neither won nor lost. */
  hasOpenDeal?: boolean;
  /** Only contacts with a deal somewhere in this pipeline. */
  pipelineId?: string;
  /** Only contacts with a deal sitting in this stage. Narrower than
   * `pipelineId`, and wins over it when both are set. */
  stageId?: string;
  createdFrom?: Date;
  createdTo?: Date;
  /** Restricts to exactly these ids — "export selection" from the bulk
   * action bar (§10 1J #1) reuses the same query path rather than a
   * separate export function. */
  ids?: string[];
  /** `custom.<key> equals|contains <value>` (§15.8 P5) — one custom field
   *  filter at a time, the saved-view shape asked for. */
  customKey?: string;
  customOp?: CustomFieldOperator;
  customValue?: string;
};

export type ContactListOptions = {
  sort?: ContactSortField;
  direction?: SortDirection;
  page?: number;
  perPage?: number;
};

export const DEFAULT_PER_PAGE = 25;

const SORT_COLUMNS = {
  name: contacts.name,
  phone: contacts.phone,
  createdAt: contacts.createdAt,
} as const;

/**
 * Resolves every filter into one SQL condition, then sorts and pages in
 * MySQL. Filters that need a join (tags, pipeline/stage, a custom field)
 * resolve their contact ids with one extra tenant-scoped read first — the
 * `tenantDb` boundary has no join helper, and one more scoped query per
 * filter is a fair trade for keeping every write and read on tenant-scoped
 * rails (§3.3).
 */
export async function queryContacts(
  ctx: TenantContext,
  query: ContactQuery = {},
  options: ContactListOptions = {},
) {
  const conditions: SQL[] = [];

  if (query.search) {
    const term = `%${query.search}%`;
    conditions.push(
      or(like(contacts.name, term), like(contacts.phone, term), like(contacts.email, term)) as SQL,
    );
  }
  if (query.ownerUserId) conditions.push(eq(contacts.ownerUserId, query.ownerUserId));
  if (query.source) conditions.push(eq(contacts.source, query.source));
  if (query.createdFrom) conditions.push(gte(contacts.createdAt, query.createdFrom));
  if (query.createdTo) conditions.push(lte(contacts.createdAt, query.createdTo));
  if (query.ids) {
    if (query.ids.length === 0) return emptyPage(options);
    conditions.push(inArray(contacts.id, query.ids));
  }

  if (query.tagId) {
    const tagged = await tenantDb(ctx).select(contactTags, eq(contactTags.tagId, query.tagId));
    if (tagged.length === 0) return emptyPage(options);
    conditions.push(inArray(contacts.id, tagged.map((row) => row.contactId)));
  }

  // has-open-deal and the pipeline/stage filter both answer "where is this
  // contact in the funnel", so they read deals and stages once between them
  // rather than each paying for its own pair of queries.
  if (query.hasOpenDeal || query.pipelineId || query.stageId) {
    const [dealRows, stageRows] = await Promise.all([
      tenantDb(ctx).select(deals),
      tenantDb(ctx).select(stages),
    ]);

    if (query.hasOpenDeal) {
      const closed = new Set(
        stageRows.filter((stage) => stage.isWon || stage.isLost).map((stage) => stage.id),
      );
      const withOpenDeal = new Set(
        dealRows.filter((deal) => !closed.has(deal.stageId)).map((deal) => deal.contactId),
      );
      if (withOpenDeal.size === 0) return emptyPage(options);
      conditions.push(inArray(contacts.id, [...withOpenDeal]));
    }

    if (query.stageId || query.pipelineId) {
      const stageIds = query.stageId
        ? new Set([query.stageId])
        : new Set(
            stageRows.filter((stage) => stage.pipelineId === query.pipelineId).map((s) => s.id),
          );
      const inStage = new Set(
        dealRows.filter((deal) => stageIds.has(deal.stageId)).map((deal) => deal.contactId),
      );
      if (inStage.size === 0) return emptyPage(options);
      conditions.push(inArray(contacts.id, [...inStage]));
    }
  }

  if (query.customKey && query.customValue) {
    // `contacts.custom` is a JSON column; MySQL's own JSON_UNQUOTE/JSON_EXTRACT
    // read the key by name. No tenantDb join helper covers this either, so
    // it composes straight into the condition list like any other SQL.
    const path = `$.${query.customKey}`;
    const extracted = sql`json_unquote(json_extract(${contacts.custom}, ${path}))`;
    conditions.push(
      (query.customOp === "contains"
        ? like(extracted, `%${query.customValue}%`)
        : eq(extracted, query.customValue)) as SQL,
    );
  }

  const where = conditions.length > 0 ? (and(...conditions) as SQL) : undefined;

  const sort = options.sort ?? "createdAt";
  const direction = options.direction ?? (sort === "createdAt" ? "desc" : "asc");
  const sortColumn = SORT_COLUMNS[sort];
  const orderBy = direction === "asc" ? asc(sortColumn) : desc(sortColumn);

  const perPage = options.perPage ?? DEFAULT_PER_PAGE;
  const unbounded = perPage >= Number.MAX_SAFE_INTEGER;

  const total = await tenantDb(ctx).count(contacts, where);
  // Unbounded (the CSV export's "the whole filtered set") is one page by
  // definition — no LIMIT is ever sent to MySQL for it (see `.limit()`
  // below), so a real page count would be meaningless.
  const pageCount = unbounded ? 1 : Math.max(1, Math.ceil(total / perPage));
  // Clamp rather than 404: a filter change that shrinks the result set below
  // the current page should land on the last page, not an error.
  const page = unbounded ? 1 : Math.min(Math.max(1, options.page ?? 1), pageCount);

  const baseQuery = tenantDb(ctx).select(contacts, where).orderBy(orderBy);
  const rows = unbounded
    ? await baseQuery
    : await baseQuery.limit(perPage).offset((page - 1) * perPage);

  return { rows, total, page, pageCount, perPage };
}

function emptyPage(options: ContactListOptions) {
  const perPage = options.perPage ?? DEFAULT_PER_PAGE;
  return { rows: [] as (typeof contacts.$inferSelect)[], total: 0, page: 1, pageCount: 1, perPage };
}

/** Distinct non-empty `source` values, for the filter dropdown. */
export async function listContactSources(ctx: TenantContext): Promise<string[]> {
  const rows = await tenantDb(ctx).select(contacts);
  const sources = new Set(
    rows.map((row) => row.source).filter((source): source is string => Boolean(source)),
  );
  return [...sources].sort((a, b) => a.localeCompare(b, "es"));
}

/** Contact ids that currently have an open deal — used to badge the table. */
export async function contactsWithOpenDeals(ctx: TenantContext): Promise<Set<string>> {
  const [dealRows, stageRows] = await Promise.all([
    tenantDb(ctx).select(deals),
    tenantDb(ctx).select(stages),
  ]);
  const closed = new Set(
    stageRows.filter((stage) => stage.isWon || stage.isLost).map((stage) => stage.id),
  );
  return new Set(
    dealRows.filter((deal) => !closed.has(deal.stageId)).map((deal) => deal.contactId),
  );
}

export function isSortField(value: string | undefined): value is ContactSortField {
  return CONTACT_SORT_FIELDS.includes(value as ContactSortField);
}
