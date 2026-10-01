import {
  PLATFORM_CRM_DATE_PRESETS,
  PLATFORM_CRM_MAX_PAGE,
  type PlatformCrmFilters,
} from "@/modules/tenancy/platform-crm";

// URL state of /platform-leads (PLAN.md §19.4): the view tab, the filters and
// the page all live in searchParams, so every filtered view is a link. This
// file turns whatever came in the URL into typed filters and drops what it
// does not recognise — an unknown value is ignored, never an error and never
// echoed back. The reader validates again (it cannot trust its caller); this
// pass keeps junk out of the form defaults and the pagination links.

export const PLATFORM_LEADS_VIEWS = ["leads", "deals", "contacts"] as const;
export type PlatformLeadsView = (typeof PLATFORM_LEADS_VIEWS)[number];

type RawParams = Record<string, string | string[] | undefined>;

const ID_PATTERN = /^[0-9A-Za-z]{26}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["open", "won", "lost"] as const;
const CHANNELS = ["form", "booking", "chat"] as const;
/** Accounts a single request can name; a platform never needs more in one filter. */
const MAX_ACCOUNTS = 50;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function all(value: string | string[] | undefined): string[] {
  return (Array.isArray(value) ? value : value === undefined ? [] : [value]).flatMap((item) =>
    item.split(","),
  );
}

/** `YYYY-MM-DD` as a UTC instant; a calendar-impossible day (2026-02-31) is not a date. */
function parseDay(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value || !DATE_PATTERN.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return undefined;
  return date;
}

export type ParsedPlatformLeadsParams = {
  view: PlatformLeadsView;
  page: number;
  /** What goes to the reader. */
  filters: PlatformCrmFilters;
  /** The accepted raw values, for form defaults and links (never the rejected ones). */
  values: {
    tenantIds: string[];
    days: number | null;
    from: string;
    to: string;
    status: string;
    source: string;
    utmSource: string;
    q: string;
  };
};

export function parsePlatformLeadsParams(params: RawParams): ParsedPlatformLeadsParams {
  const requestedView = first(params.view);
  const view =
    (PLATFORM_LEADS_VIEWS as readonly string[]).includes(requestedView ?? "")
      ? (requestedView as PlatformLeadsView)
      : "leads";

  const tenantIds = [...new Set(all(params.tenant).filter((id) => ID_PATTERN.test(id)))].slice(
    0,
    MAX_ACCOUNTS,
  );

  const rawDays = first(params.days);
  const parsedDays = rawDays && /^\d{1,3}$/.test(rawDays) ? Number(rawDays) : NaN;
  const days = (PLATFORM_CRM_DATE_PRESETS as readonly number[]).includes(parsedDays)
    ? parsedDays
    : null;

  // A custom range needs both ends; one valid end alone is ignored.
  const from = parseDay(first(params.from), false);
  const to = parseDay(first(params.to), true);
  const range = from && to && from <= to ? { from, to } : null;

  const rawStatus = first(params.status);
  const status = (STATUSES as readonly string[]).includes(rawStatus ?? "") ? rawStatus! : "";

  const rawSource = first(params.source);
  const source =
    (CHANNELS as readonly string[]).includes(rawSource ?? "") ||
    (rawSource?.startsWith("site:") && ID_PATTERN.test(rawSource.slice("site:".length)))
      ? rawSource!
      : "";

  const utmSource = (first(params.utm) ?? "").trim().slice(0, 200);
  const q = (first(params.q) ?? "").trim().slice(0, 100);

  const rawPage = first(params.page);
  const pageNumber = rawPage && /^\d{1,4}$/.test(rawPage) ? Number(rawPage) : 1;
  const page = Math.min(Math.max(pageNumber, 1), PLATFORM_CRM_MAX_PAGE);

  return {
    view,
    page,
    filters: {
      tenantIds: tenantIds.length ? tenantIds : undefined,
      days: days ?? undefined,
      from: range?.from,
      to: range?.to,
      status: status || undefined,
      source: source || undefined,
      utmSource: utmSource || undefined,
      q: q || undefined,
    },
    values: {
      tenantIds,
      days,
      from: range ? first(params.from)! : "",
      to: range ? first(params.to)! : "",
      status,
      source,
      utmSource,
      q,
    },
  };
}

/** A link to the same view with these overrides, keeping only accepted filters. */
export function platformLeadsHref(
  parsed: ParsedPlatformLeadsParams,
  overrides: { view?: PlatformLeadsView; page?: number } = {},
): string {
  const { values } = parsed;
  const search = new URLSearchParams();
  const view = overrides.view ?? parsed.view;
  if (view !== "leads") search.set("view", view);
  for (const id of values.tenantIds) search.append("tenant", id);
  if (values.from && values.to) {
    search.set("from", values.from);
    search.set("to", values.to);
  } else if (values.days !== null) {
    search.set("days", String(values.days));
  }
  if (values.status) search.set("status", values.status);
  if (values.source) search.set("source", values.source);
  if (values.utmSource) search.set("utm", values.utmSource);
  if (values.q) search.set("q", values.q);
  const page = overrides.page ?? parsed.page;
  if (page > 1) search.set("page", String(page));
  const query = search.toString();
  return query ? `/platform-leads?${query}` : "/platform-leads";
}
