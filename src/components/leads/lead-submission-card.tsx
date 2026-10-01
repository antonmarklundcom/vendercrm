import Link from "next/link";
import { formatDateTime } from "@/lib/i18n/format";
import type { FieldValue, LeadSubmissionView } from "@/modules/leads/view";

// One website/form/booking submission, drawn from its view-model (PLAN.md
// §19.2). Synchronous and presentational — labels come in as props, like
// TaskList — so a test can render it with renderToStaticMarkup.
//
// Every value here is a string from the public internet. It reaches the page
// only as a React child (escaped); there is no raw-HTML escape hatch in this
// file, and a test greps for it.

export type LeadCardLabels = {
  title: string;
  receivedAt: string;
  origin: string;
  originSite: string;
  originForm: string;
  originBooking: string;
  originChat: string;
  name: string;
  phone: string;
  email: string;
  fromContact: string;
  message: string;
  fields: string;
  attribution: string;
  source: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm: string;
  utmContent: string;
  gclid: string;
  fbclid: string;
  pageUrl: string;
  referrer: string;
  showAll: string;
  yes: string;
  no: string;
  emptyValue: string;
  openDeal: string;
  review: string;
  reviewHint: string;
};

const LABEL_KEYS: Array<keyof LeadCardLabels> = [
  "title",
  "receivedAt",
  "origin",
  "originSite",
  "originForm",
  "originBooking",
  "originChat",
  "name",
  "phone",
  "email",
  "fromContact",
  "message",
  "fields",
  "attribution",
  "source",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmTerm",
  "utmContent",
  "gclid",
  "fbclid",
  "pageUrl",
  "referrer",
  "showAll",
  "yes",
  "no",
  "emptyValue",
  "openDeal",
  "review",
  "reviewHint",
];

/** Reads every card label out of the `app.leadData` namespace. */
export function buildLeadCardLabels(t: (key: string) => string): LeadCardLabels {
  return Object.fromEntries(LABEL_KEYS.map((key) => [key, t(key)])) as LeadCardLabels;
}

const LONG_TEXT = 600;
const URL_DISPLAY = 60;

function truncateMiddle(value: string, max: number): string {
  if (value.length <= max) return value;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - (keep - head))}`;
}

/** Only http(s) URLs become links — never javascript:, data: and friends. */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function LongText({ text, showAll }: { text: string; showAll: string }) {
  if (text.length <= LONG_TEXT) {
    return <span className="whitespace-pre-wrap break-words">{text}</span>;
  }
  return (
    <span className="block min-w-0">
      <span className="whitespace-pre-wrap break-words">{text.slice(0, LONG_TEXT)}…</span>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-muted-foreground">{showAll}</summary>
        <span className="mt-1 block whitespace-pre-wrap break-words">{text}</span>
      </details>
    </span>
  );
}

function Value({ value, labels }: { value: FieldValue; labels: LeadCardLabels }) {
  switch (value.kind) {
    case "text":
      return <LongText text={value.text} showAll={labels.showAll} />;
    case "bool":
      return <span>{value.value ? labels.yes : labels.no}</span>;
    case "list":
      return <LongText text={value.items.join(", ")} showAll={labels.showAll} />;
    case "json":
      return (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
          {value.text}
        </pre>
      );
    case "empty":
      return <span className="text-muted-foreground">{labels.emptyValue}</span>;
  }
}

function UrlValue({ value }: { value: string }) {
  const shown = truncateMiddle(value, URL_DISPLAY);
  if (!isHttpUrl(value)) {
    return (
      <span className="break-all" title={value}>
        {shown}
      </span>
    );
  }
  return (
    <a
      href={value}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={value}
      className="break-all underline underline-offset-4"
    >
      {shown}
    </a>
  );
}

function Item({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0" title={title}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

export function LeadSubmissionCard({
  view,
  labels,
  locale,
}: {
  view: LeadSubmissionView;
  labels: LeadCardLabels;
  locale: string;
}) {
  const originLabel = {
    site: labels.originSite,
    form: labels.originForm,
    booking: labels.originBooking,
    chat: labels.originChat,
  }[view.origin.kind];
  const originName = [view.origin.name, view.origin.domain].filter(Boolean).join(" · ");

  const prominentRows = view.rows.filter((row) => row.prominent);
  const regularRows = view.rows.filter((row) => !row.prominent);
  const messageLabel = view.messageLabel ?? labels.message;
  const attribution: Array<[string, string | null]> = [
    [labels.source, view.attribution.source],
    [labels.utmSource, view.attribution.utmSource],
    [labels.utmMedium, view.attribution.utmMedium],
    [labels.utmCampaign, view.attribution.utmCampaign],
    [labels.utmTerm, view.attribution.utmTerm],
    [labels.utmContent, view.attribution.utmContent],
    [labels.gclid, view.attribution.gclid],
    [labels.fbclid, view.attribution.fbclid],
  ];
  const attributionRows = attribution.filter(([, value]) => value);
  const hasAttribution =
    attributionRows.length > 0 || view.attribution.pageUrl || view.attribution.referrer;

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-md border px-3 py-3">
      {view.needsReview.length > 0 && (
        <p>
          <span
            className="inline-block rounded-full border border-amber-500 px-2 py-0.5 text-xs font-medium"
            title={`${labels.reviewHint}: ${view.needsReview.join(", ")}`}
          >
            {labels.review}
          </span>
        </p>
      )}

      {(prominentRows.length > 0 || (view.messageProminent && view.message)) && (
        <dl className="flex min-w-0 flex-col gap-3">
          {prominentRows.map((row) => (
            <div key={row.key} className="min-w-0" title={row.key}>
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words text-lg font-semibold">
                <Value value={row.value} labels={labels} />
              </dd>
            </div>
          ))}
          {view.messageProminent && view.message && (
            <div className="min-w-0" title="message">
              <dt className="text-xs text-muted-foreground">{messageLabel}</dt>
              <dd className="min-w-0 break-words text-lg font-semibold">
                <LongText text={view.message} showAll={labels.showAll} />
              </dd>
            </div>
          )}
        </dl>
      )}

      <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Item label={labels.receivedAt}>{formatDateTime(view.receivedAt, locale)}</Item>
        <Item label={labels.origin}>
          {originLabel}
          {originName ? `: ${originName}` : ""}
        </Item>
        {view.contact.name && <Item label={labels.name}>{view.contact.name}</Item>}
        {view.contact.phone && <Item label={labels.phone}>{view.contact.phone}</Item>}
        {view.contact.email && (
          <Item label={labels.email}>
            {view.contact.email}
            {view.contact.fromContact && (
              <span className="ml-1 text-xs text-muted-foreground">({labels.fromContact})</span>
            )}
          </Item>
        )}
      </dl>

      {view.message && !view.messageProminent && (
        <dl>
          <Item label={messageLabel} title="message">
            <LongText text={view.message} showAll={labels.showAll} />
          </Item>
        </dl>
      )}

      {regularRows.length > 0 && (
        <section className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-medium">{labels.fields}</h3>
          <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
            {regularRows.map((row) => (
              <Item key={row.key} label={row.label} title={row.key}>
                <Value value={row.value} labels={labels} />
              </Item>
            ))}
          </dl>
        </section>
      )}

      {hasAttribution && (
        <section className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-medium">{labels.attribution}</h3>
          <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
            {attributionRows.map(([label, value]) => (
              <Item key={label} label={label}>
                {value}
              </Item>
            ))}
            {view.attribution.pageUrl && (
              <Item label={labels.pageUrl}>
                <UrlValue value={view.attribution.pageUrl} />
              </Item>
            )}
            {view.attribution.referrer && (
              <Item label={labels.referrer}>
                <UrlValue value={view.attribution.referrer} />
              </Item>
            )}
          </dl>
        </section>
      )}
    </div>
  );
}

/**
 * A collapsible card with date + origin as its summary — for the contact's
 * other submissions and the timeline (§19.2).
 */
export function LeadSubmissionDisclosure({
  view,
  labels,
  locale,
  open = false,
  linkDeal = false,
}: {
  view: LeadSubmissionView;
  labels: LeadCardLabels;
  locale: string;
  open?: boolean;
  linkDeal?: boolean;
}) {
  const summary = [view.origin.name, view.origin.domain].filter(Boolean).join(" · ");
  return (
    <details open={open} className="min-w-0 rounded-md border">
      <summary className="cursor-pointer px-3 py-2 text-sm">
        <span className="font-medium">{formatDateTime(view.receivedAt, locale)}</span>
        {summary && <span className="ml-2 text-muted-foreground">{summary}</span>}
      </summary>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <LeadSubmissionCard view={view} labels={labels} locale={locale} />
        {linkDeal && view.dealId && (
          <Link href={`/pipeline/${view.dealId}`} className="w-fit text-sm underline underline-offset-4">
            {labels.openDeal}
          </Link>
        )}
      </div>
    </details>
  );
}
