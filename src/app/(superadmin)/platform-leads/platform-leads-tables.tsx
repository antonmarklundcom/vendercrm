import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatDateTime, formatMoney } from "@/lib/i18n/format";
import type {
  PlatformContactRow,
  PlatformCrmStatus,
  PlatformDealRow,
  PlatformLeadRow,
} from "@/modules/tenancy/platform-crm";

// The three result tables of /platform-leads (PLAN.md §19.4 "Columns").
// Synchronous and presentational — labels come in as props, like the lead
// card — so a test can render them with renderToStaticMarkup.
//
// Every cell is a string that came from the public internet (names, e-mails,
// messages, form fields). It reaches the page only as a React child
// (escaped); there is no raw-HTML escape hatch in this file.

type T = (key: string, values?: Record<string, string | number>) => string;

export type PlatformLeadsLabels = {
  columns: Record<
    | "received"
    | "account"
    | "origin"
    | "name"
    | "phone"
    | "email"
    | "message"
    | "fields"
    | "utm"
    | "stage"
    | "open"
    | "created"
    | "title"
    | "contact"
    | "pipeline"
    | "status"
    | "value"
    | "owner"
    | "source"
    | "lastStageChange"
    | "firstSite"
    | "openDeals",
    string
  >;
  review: string;
  reviewTitle: (codes: string) => string;
  accountStatus: Record<string, string>;
  dealStatus: Record<PlatformCrmStatus, string>;
  origin: Record<"form" | "booking" | "chat", string>;
  openRow: string;
};

export function buildPlatformLeadsLabels(t: T): PlatformLeadsLabels {
  const columnKeys = [
    "received",
    "account",
    "origin",
    "name",
    "phone",
    "email",
    "message",
    "fields",
    "utm",
    "stage",
    "open",
    "created",
    "title",
    "contact",
    "pipeline",
    "status",
    "value",
    "owner",
    "source",
    "lastStageChange",
    "firstSite",
    "openDeals",
  ] as const;
  const pick = <K extends string>(prefix: string, keys: readonly K[]) =>
    Object.fromEntries(keys.map((key) => [key, t(`${prefix}.${key}`)])) as Record<K, string>;
  return {
    columns: pick("columns", columnKeys),
    review: t("review"),
    reviewTitle: (codes) => t("reviewTitle", { codes }),
    accountStatus: pick("accountStatus", ["active", "trial", "suspended"] as const),
    dealStatus: pick("dealStatus", ["open", "won", "lost"] as const),
    origin: pick("origin", ["form", "booking", "chat"] as const),
    openRow: t("openRow"),
  };
}

const ACCOUNT_TONE: Record<string, string> = {
  active: "bg-success-surface text-success",
  trial: "bg-muted text-muted-foreground",
  suspended: "bg-destructive-surface text-destructive",
};

const STATUS_TONE: Record<PlatformCrmStatus, string> = {
  open: "bg-muted text-muted-foreground",
  won: "bg-success-surface text-success",
  lost: "bg-destructive-surface text-destructive",
};

const EMPTY = "—";

export function AccountCell({
  name,
  status,
  labels,
}: {
  name: string;
  status: string;
  labels: PlatformLeadsLabels;
}) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <span className="break-words">{name}</span>
      <span
        className={cn(
          "inline-block rounded-full px-2 py-0.5 text-xs",
          ACCOUNT_TONE[status] ?? "bg-muted text-muted-foreground",
        )}
      >
        {labels.accountStatus[status] ?? status}
      </span>
    </div>
  );
}

export function StatusChip({
  status,
  labels,
}: {
  status: PlatformCrmStatus;
  labels: PlatformLeadsLabels;
}) {
  return (
    <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs", STATUS_TONE[status])}>
      {labels.dealStatus[status]}
    </span>
  );
}

export function ReviewBadge({ codes, labels }: { codes: string[]; labels: PlatformLeadsLabels }) {
  if (codes.length === 0) return null;
  return (
    <span
      className="inline-block rounded-full border border-amber-500 px-2 py-0.5 text-xs font-medium"
      title={labels.reviewTitle(codes.join(", "))}
    >
      {labels.review}
    </span>
  );
}

function dealHref(tenantId: string, dealId: string) {
  return `/platform-leads/${encodeURIComponent(tenantId)}/deals/${encodeURIComponent(dealId)}`;
}

function contactHref(tenantId: string, contactId: string) {
  return `/platform-leads/${encodeURIComponent(tenantId)}/contacts/${encodeURIComponent(contactId)}`;
}

function OpenLink({ href, labels }: { href: string | null; labels: PlatformLeadsLabels }) {
  if (!href) return <span className="text-muted-foreground">{EMPTY}</span>;
  return (
    <Link href={href} className="whitespace-nowrap underline underline-offset-4">
      {labels.openRow}
    </Link>
  );
}

// One markup, two layouts. Below `md` the table, its rows and its cells are
// plain blocks, so each row reads as a stacked card (cells carry a
// `data-label` that shows as a small prefix; the secondary ones are hidden).
// From `md` up they are the table parts again and the table scrolls inside
// its own container. The page itself never scrolls horizontally.
const TABLE = "block w-full text-left text-sm md:table md:min-w-[56rem]";
const THEAD = "hidden md:table-header-group";
const TBODY = "block md:table-row-group";
const TR = "block border-b py-3 last:border-b-0 md:table-row md:py-0";
const TH = "py-2 pr-4 text-xs font-medium text-muted-foreground";
const TD = "block py-1 md:table-cell md:py-2.5 md:pr-4 md:align-top";
const TD_HIDDEN_ON_PHONE = "hidden md:table-cell md:py-2.5 md:pr-4 md:align-top";
const TD_LABEL =
  "before:mr-2 before:text-xs before:text-muted-foreground before:content-[attr(data-label)] md:before:content-none";

/** The scroll container: the table scrolls inside it, never the page. */
function Scroller({ children }: { children: React.ReactNode }) {
  return <div className="max-w-full overflow-x-auto rounded-md border px-3">{children}</div>;
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

export function LeadsTable({
  rows,
  labels,
  locale,
}: {
  rows: PlatformLeadRow[];
  labels: PlatformLeadsLabels;
  locale: string;
}) {
  const c = labels.columns;
  return (
    <Scroller>
      <table className={TABLE}>
        <thead className={THEAD}>
          <tr className="border-b">
            {[c.received, c.account, c.origin, c.name, c.phone, c.email, c.message, c.fields, c.utm, c.stage, c.open].map(
              (heading) => (
                <th key={heading} className={TH}>
                  {heading}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className={TBODY}>
          {rows.map((row) => {
            const originName = [row.origin.name, row.origin.domain].filter(Boolean).join(" · ");
            const origin =
              row.origin.kind === "site"
                ? originName
                : [labels.origin[row.origin.kind], row.origin.name].filter(Boolean).join(": ");
            return (
              <tr key={row.id} className={TR}>
                <td className={TD}>
                  <div className="flex flex-col items-start gap-1">
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(row.receivedAt, locale)}
                    </span>
                    <ReviewBadge codes={row.needsReview} labels={labels} />
                  </div>
                </td>
                <td className={TD}>
                  <AccountCell name={row.tenantName} status={row.tenantStatus} labels={labels} />
                </td>
                <td data-label={c.origin} className={cn(TD, TD_LABEL, "break-words")}>{origin || <Muted>{EMPTY}</Muted>}</td>
                <td data-label={c.name} className={cn(TD, TD_LABEL, "break-words")}>{row.name ?? <Muted>{EMPTY}</Muted>}</td>
                <td data-label={c.phone} className={cn(TD, TD_LABEL, "whitespace-nowrap")}>{row.phone ?? <Muted>{EMPTY}</Muted>}</td>
                <td data-label={c.email} className={cn(TD, TD_LABEL, "break-all")}>{row.email ?? <Muted>{EMPTY}</Muted>}</td>
                <td data-label={c.message} className={cn(TD, TD_LABEL, "max-w-xs whitespace-pre-line break-words")}>
                  {row.message ?? <Muted>{EMPTY}</Muted>}
                </td>
                <td data-label={c.fields} className={cn(TD_HIDDEN_ON_PHONE, TD_LABEL, "max-w-xs break-words text-xs")}>
                  {row.fields.length ? (
                    row.fields.map((field) => `${field.key}: ${field.value}`).join(" · ")
                  ) : (
                    <Muted>{EMPTY}</Muted>
                  )}
                </td>
                <td data-label={c.utm} className={cn(TD_HIDDEN_ON_PHONE, TD_LABEL, "break-words text-xs")}>
                  {[row.utmSource, row.utmCampaign].filter(Boolean).join(" / ") || <Muted>{EMPTY}</Muted>}
                </td>
                <td data-label={c.stage} className={cn(TD, TD_LABEL)}>
                  {row.dealStatus ? (
                    <div className="flex flex-col items-start gap-1">
                      <StatusChip status={row.dealStatus} labels={labels} />
                      {row.stageName && <span className="break-words text-xs">{row.stageName}</span>}
                    </div>
                  ) : (
                    <Muted>{EMPTY}</Muted>
                  )}
                </td>
                <td className={TD}>
                  <OpenLink href={row.dealId ? dealHref(row.tenantId, row.dealId) : null} labels={labels} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Scroller>
  );
}

export function DealsTable({
  rows,
  labels,
  locale,
}: {
  rows: PlatformDealRow[];
  labels: PlatformLeadsLabels;
  locale: string;
}) {
  const c = labels.columns;
  return (
    <Scroller>
      <table className={cn(TABLE, "md:min-w-[64rem]")}>
        <thead className={THEAD}>
          <tr className="border-b">
            {[
              c.created,
              c.account,
              c.title,
              c.contact,
              c.phone,
              c.pipeline,
              c.stage,
              c.status,
              c.value,
              c.owner,
              c.source,
              c.lastStageChange,
              c.open,
            ].map((heading) => (
              <th key={heading} className={TH}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={TBODY}>
          {rows.map((row) => (
            <tr key={row.id} className={TR}>
              <td className={cn(TD, "whitespace-nowrap text-xs text-muted-foreground")}>
                {formatDateTime(row.createdAt, locale)}
              </td>
              <td className={TD}>
                <AccountCell name={row.tenantName} status={row.tenantStatus} labels={labels} />
              </td>
              <td className={cn(TD, "break-words")}>{row.title}</td>
              <td data-label={c.contact} className={cn(TD, TD_LABEL, "break-words")}>{row.contactName}</td>
              <td data-label={c.phone} className={cn(TD, TD_LABEL, "whitespace-nowrap")}>{row.contactPhone}</td>
              <td data-label={c.pipeline} className={cn(TD_HIDDEN_ON_PHONE, TD_LABEL, "break-words")}>{row.pipelineName}</td>
              <td data-label={c.stage} className={cn(TD, TD_LABEL, "break-words")}>{row.stageName}</td>
              <td className={TD}>
                <StatusChip status={row.status} labels={labels} />
              </td>
              {/* Per currency; never summed across rows. */}
              <td data-label={c.value} className={cn(TD, TD_LABEL, "whitespace-nowrap tabular-nums")}>
                {formatMoney(row.value, row.currency, locale)}
              </td>
              <td data-label={c.owner} className={cn(TD_HIDDEN_ON_PHONE, TD_LABEL, "break-words")}>{row.ownerName ?? <Muted>{EMPTY}</Muted>}</td>
              <td data-label={c.source} className={cn(TD_HIDDEN_ON_PHONE, TD_LABEL, "break-words text-xs")}>
                {[row.siteDomain ?? row.siteName, row.source].filter(Boolean).join(" · ") || (
                  <Muted>{EMPTY}</Muted>
                )}
              </td>
              <td data-label={c.lastStageChange} className={cn(TD_HIDDEN_ON_PHONE, TD_LABEL, "whitespace-nowrap text-xs text-muted-foreground")}>
                {formatDateTime(row.stageEnteredAt, locale)}
              </td>
              <td className={TD}>
                <OpenLink href={dealHref(row.tenantId, row.id)} labels={labels} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroller>
  );
}

export function ContactsTable({
  rows,
  labels,
  locale,
}: {
  rows: PlatformContactRow[];
  labels: PlatformLeadsLabels;
  locale: string;
}) {
  const c = labels.columns;
  return (
    <Scroller>
      <table className={cn(TABLE, "md:min-w-[48rem]")}>
        <thead className={THEAD}>
          <tr className="border-b">
            {[c.created, c.account, c.name, c.phone, c.email, c.source, c.firstSite, c.openDeals, c.open].map(
              (heading) => (
                <th key={heading} className={TH}>
                  {heading}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className={TBODY}>
          {rows.map((row) => (
            <tr key={row.id} className={TR}>
              <td className={cn(TD, "whitespace-nowrap text-xs text-muted-foreground")}>
                {formatDateTime(row.createdAt, locale)}
              </td>
              <td className={TD}>
                <AccountCell name={row.tenantName} status={row.tenantStatus} labels={labels} />
              </td>
              <td className={cn(TD, "break-words")}>{row.name}</td>
              <td data-label={c.phone} className={cn(TD, TD_LABEL, "whitespace-nowrap")}>{row.phone}</td>
              <td data-label={c.email} className={cn(TD, TD_LABEL, "break-all")}>{row.email ?? <Muted>{EMPTY}</Muted>}</td>
              <td data-label={c.source} className={cn(TD_HIDDEN_ON_PHONE, TD_LABEL, "break-words")}>{row.source ?? <Muted>{EMPTY}</Muted>}</td>
              <td data-label={c.firstSite} className={cn(TD_HIDDEN_ON_PHONE, TD_LABEL, "break-words")}>
                {row.firstSiteDomain ?? row.firstSiteName ?? <Muted>{EMPTY}</Muted>}
              </td>
              <td data-label={c.openDeals} className={cn(TD, TD_LABEL, "tabular-nums")}>{row.openDeals}</td>
              <td className={TD}>
                <OpenLink href={contactHref(row.tenantId, row.id)} labels={labels} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroller>
  );
}
