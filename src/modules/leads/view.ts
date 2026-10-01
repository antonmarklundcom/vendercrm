// View-model for one lead submission (PLAN.md §19.2). Pure and synchronous on
// purpose: every decision about what the deal page and the contact timeline
// show lives here, so it can be tested without a database or a browser, and
// so a field a site adds tomorrow appears with no code change. No branch of
// this file produces HTML — values reach the screen only as React children.

export type FieldValue =
  | { kind: "text"; text: string }
  | { kind: "bool"; value: boolean }
  | { kind: "list"; items: string[] }
  | { kind: "json"; text: string }
  | { kind: "empty" };

export type LeadOrigin = {
  kind: "site" | "form" | "booking" | "chat";
  name: string | null;
  domain: string | null;
};

export type LeadViewRow = {
  key: string;
  label: string;
  value: FieldValue;
  prominent: boolean;
};

export type LeadSubmissionView = {
  id: string;
  receivedAt: Date;
  needsReview: string[];
  origin: LeadOrigin;
  contact: {
    name: string | null;
    email: string | null;
    phone: string | null;
    /** True when any of the three comes from the contact, not the submission. */
    fromContact: boolean;
  };
  message: string | null;
  /** The message follows the same label/prominence settings as any field. */
  messageLabel: string | null;
  messageProminent: boolean;
  rows: LeadViewRow[];
  attribution: {
    /** Not stored on the submission yet; null until the ingest snapshot lands. */
    source: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmTerm: string | null;
    utmContent: string | null;
    gclid: string | null;
    fbclid: string | null;
    pageUrl: string | null;
    referrer: string | null;
  };
  dealId: string | null;
};

/** The columns of a `lead_submissions` row the view reads. */
export type LeadSubmissionSource = {
  id: string;
  createdAt: Date;
  payload: unknown;
  utm: unknown;
  notes: string | null;
  pageUrl: string | null;
  referrer: string | null;
  dealId: string | null;
};

/** `sites.settings.fieldLabels` / `fieldDisplay` (§19.2) — owner-editable. */
export type LeadFieldSiteSettings = {
  fieldLabels?: Record<string, string>;
  fieldDisplay?: Record<string, { prominent?: boolean }>;
};

export type LeadViewContext = {
  origin: LeadOrigin;
  contact: { name: string | null; email: string | null; phone: string | null } | null;
  /** Labels of a hosted form's fields, by key (`forms.fields[].label`). */
  formLabels?: Record<string, string>;
  siteSettings?: LeadFieldSiteSettings;
  /** The i18n dictionary of common keys (`app.leadData.fieldNames`). */
  fieldNames?: Record<string, string>;
  needsReview?: string[];
};

export const MAX_FIELD_LABEL_LENGTH = 80;

/** Never customer data, whatever a site or a form forwards. */
const DENY_KEYS = new Set(["turnstile_token", "cf-turnstile-response", "_hp"]);

const hasOwn = (record: object, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `tipo_de_propiedad` / `tipo-de-propiedad` / `tipoDePropiedad` -> "Tipo de propiedad". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_FIELD_LABEL_LENGTH);
  return trimmed || null;
}

function lookup<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  if (!record) return undefined;
  if (hasOwn(record, key)) return record[key];
  const lower = key.toLowerCase();
  return hasOwn(record, lower) ? record[lower] : undefined;
}

/**
 * Label order (§19.2): per-site override -> hosted-form label -> dictionary
 * -> humanizer. Later phases only fill `siteSettings`; the order is fixed here.
 */
export function resolveFieldLabel(
  key: string,
  sources: Pick<LeadViewContext, "siteSettings" | "formLabels" | "fieldNames">,
): string {
  const site = cleanLabel(lookup(sources.siteSettings?.fieldLabels, key));
  if (site) return site;
  const form = cleanLabel(lookup(sources.formLabels, key));
  if (form) return form;
  const known = cleanLabel(
    sources.fieldNames && hasOwn(sources.fieldNames, key.toLowerCase())
      ? sources.fieldNames[key.toLowerCase()]
      : undefined,
  );
  if (known) return known;
  return humanizeKey(key);
}

export function isProminent(
  key: string,
  siteSettings: LeadFieldSiteSettings | undefined,
): boolean {
  return lookup(siteSettings?.fieldDisplay, key)?.prominent === true;
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return ["string", "number", "boolean"].includes(typeof value);
}

export function toFieldValue(value: unknown): FieldValue {
  if (value === null || value === undefined) return { kind: "empty" };
  if (typeof value === "string") {
    return value.trim() === "" ? { kind: "empty" } : { kind: "text", text: value };
  }
  if (typeof value === "number") return { kind: "text", text: String(value) };
  if (typeof value === "boolean") return { kind: "bool", value };
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: "empty" };
    if (value.every(isPrimitive)) return { kind: "list", items: value.map(String) };
    return { kind: "json", text: JSON.stringify(value, null, 2) };
  }
  if (isRecord(value)) {
    return Object.keys(value).length === 0
      ? { kind: "empty" }
      : { kind: "json", text: JSON.stringify(value, null, 2) };
  }
  return { kind: "text", text: String(value) };
}

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

export function buildLeadSubmissionView(
  submission: LeadSubmissionSource,
  context: LeadViewContext,
): LeadSubmissionView {
  const payload = isRecord(submission.payload) ? submission.payload : {};
  const utm = isRecord(submission.utm) ? submission.utm : {};
  const labelSources = {
    siteSettings: context.siteSettings,
    formLabels: context.formLabels,
    fieldNames: context.fieldNames,
  };

  // Hosted forms keep name/phone/email (and the message) inside the payload;
  // a key that fills a dedicated slot is not repeated as a row. A value that
  // is not a usable string stays a row — nothing is hidden twice or for good.
  const ownName = nonEmptyString(payload.name);
  const ownPhone = nonEmptyString(payload.phone);
  const ownEmail = nonEmptyString(payload.email);
  const notes = nonEmptyString(submission.notes);
  const payloadMessage = nonEmptyString(payload.message);
  const message = notes ?? payloadMessage;
  const slotKeys = new Set<string>();
  if (ownName) slotKeys.add("name");
  if (ownPhone) slotKeys.add("phone");
  if (ownEmail) slotKeys.add("email");
  if (payloadMessage && (!notes || notes === payloadMessage)) slotKeys.add("message");

  const rows: LeadViewRow[] = Object.entries(payload)
    .filter(([key]) => !DENY_KEYS.has(key.toLowerCase()) && !slotKeys.has(key))
    .map(([key, raw]) => ({
      key,
      label: resolveFieldLabel(key, labelSources),
      value: toFieldValue(raw),
      prominent: isProminent(key, context.siteSettings),
    }));
  // Stable: prominent first, everything else keeps the order it was sent in.
  const ordered = [...rows.filter((row) => row.prominent), ...rows.filter((row) => !row.prominent)];

  const contact = context.contact;
  const name = ownName ?? contact?.name ?? null;
  const phone = ownPhone ?? contact?.phone ?? null;
  const email = ownEmail ?? contact?.email ?? null;

  const text = (value: unknown) => nonEmptyString(value);

  return {
    id: submission.id,
    receivedAt: submission.createdAt,
    needsReview: context.needsReview ?? [],
    origin: context.origin,
    contact: {
      name,
      email,
      phone,
      fromContact: !ownName || !ownPhone || !ownEmail,
    },
    message,
    messageLabel: cleanLabel(lookup(context.siteSettings?.fieldLabels, "message")),
    messageProminent: isProminent("message", context.siteSettings),
    rows: ordered,
    attribution: {
      source: null,
      utmSource: text(utm.source),
      utmMedium: text(utm.medium),
      utmCampaign: text(utm.campaign),
      utmTerm: text(utm.term),
      utmContent: text(utm.content),
      gclid: text(utm.gclid),
      fbclid: text(utm.fbclid),
      pageUrl: text(submission.pageUrl),
      referrer: text(submission.referrer),
    },
    dealId: submission.dealId,
  };
}
