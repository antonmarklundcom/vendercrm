import {
  isSortField,
  type ContactListOptions,
  type ContactQuery,
  type SortDirection,
} from "@/modules/crm/contact-list";

// One parser for the contacts list's URL state, shared by the page and the
// CSV route. Both must read the same params the same way — that is what makes
// "export what I'm looking at" true rather than aspirational.

export type ContactSearchParams = {
  search?: string;
  tagId?: string;
  source?: string;
  ownerUserId?: string;
  pipelineId?: string;
  stageId?: string;
  openDeal?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: string;
  page?: string;
  /** Comma-separated contact ids — "export selection" from the bulk bar. */
  ids?: string;
  /** `custom.<key> equals|contains <value>` (§15.8 P5). */
  customKey?: string;
  customOp?: string;
  customValue?: string;
};

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function parseContactQuery(params: ContactSearchParams): ContactQuery {
  const createdTo = parseDate(params.to);
  // A date input gives midnight; the user means "through the end of that day".
  if (createdTo) createdTo.setHours(23, 59, 59, 999);

  return {
    search: params.search || undefined,
    tagId: params.tagId || undefined,
    source: params.source || undefined,
    ownerUserId: params.ownerUserId || undefined,
    pipelineId: params.pipelineId || undefined,
    stageId: params.stageId || undefined,
    hasOpenDeal: params.openDeal === "1",
    createdFrom: parseDate(params.from),
    createdTo,
    ids: params.ids ? params.ids.split(",").filter(Boolean) : undefined,
    customKey: params.customKey || undefined,
    customOp: params.customOp === "contains" ? "contains" : "equals",
    customValue: params.customValue || undefined,
  };
}

export function parseContactOptions(params: ContactSearchParams): ContactListOptions {
  const sort = isSortField(params.sort) ? params.sort : undefined;
  const direction: SortDirection | undefined =
    params.dir === "asc" || params.dir === "desc" ? params.dir : undefined;
  const page = Number.parseInt(params.page ?? "", 10);

  return {
    sort,
    direction,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** True when any filter is active — distinguishes "no data" from "no match". */
export function hasActiveFilters(params: ContactSearchParams): boolean {
  return Boolean(
    params.search ||
      params.tagId ||
      params.source ||
      params.ownerUserId ||
      params.pipelineId ||
      params.stageId ||
      params.openDeal === "1" ||
      params.from ||
      params.to ||
      (params.customKey && params.customValue),
  );
}

/** Rebuilds the querystring with overrides — used by sort headers and paging. */
export function buildContactHref(
  params: ContactSearchParams,
  overrides: Partial<ContactSearchParams>,
): string {
  const next = new URLSearchParams();
  const merged = { ...params, ...overrides };

  for (const [key, value] of Object.entries(merged)) {
    if (value) next.set(key, String(value));
  }
  const query = next.toString();
  return query ? `?${query}` : "";
}

/**
 * The filter/sort keys a saved view is allowed to carry (§10 1J #1's
 * "guardar vista"). `page` is deliberately absent — a view is a filter, not a
 * scroll position — and so is `ids`, which only ever describes one session's
 * checkbox selection.
 */
const VIEW_KEYS = [
  "search",
  "tagId",
  "source",
  "ownerUserId",
  "pipelineId",
  "stageId",
  "openDeal",
  "from",
  "to",
  "sort",
  "dir",
  "customKey",
  "customOp",
  "customValue",
] as const satisfies readonly (keyof ContactSearchParams)[];

/**
 * Canonical querystring for a saved view: known keys only, always in the same
 * order. Round-tripping through this is what makes a stored view safe to hand
 * back to the browser as a link — nothing a user typed into the URL survives
 * unless it is one of the filters above.
 */
export function serializeContactView(params: ContactSearchParams): string {
  const next = new URLSearchParams();
  for (const key of VIEW_KEYS) {
    const value = params[key];
    if (value) next.set(key, String(value));
  }
  return next.toString();
}

/** The same narrowing applied to a stored string, for rendering a view link. */
export function parseContactView(query: string): string {
  const parsed = Object.fromEntries(new URLSearchParams(query)) as ContactSearchParams;
  return serializeContactView(parsed);
}
