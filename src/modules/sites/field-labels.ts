import { desc, eq } from "drizzle-orm";
import { leadSubmissions } from "@/db/schema";
import es from "../../../messages/es.json";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { writeAuditLog } from "@/modules/tenancy/audit";
import { MAX_FIELD_LABEL_LENGTH } from "@/modules/leads/view";
import { getSite } from "./sites";
import { mergeSiteSettings, siteSettings } from "./settings";

// Field-label editor (PLAN.md §19.2, phase L3). The owner renames the keys a
// site sends and marks some "Destacar"; both live in the site's existing
// `settings` JSON (`fieldLabels`, `fieldDisplay`) — no migration. The lead
// card's view-model already reads them (modules/leads/view.ts), so saving
// here changes every card for the site, old leads included.
//
// Labels are plain text. Nothing here sanitises or escapes: the value is
// stored as typed and only ever reaches a screen as a React child.

/** How many recent submissions are scanned for keys (bounded sample). */
export const FIELD_KEY_SAMPLE_SIZE = 300;
/** A form with more distinct keys than this is not a form; cap the editor. */
export const MAX_FIELD_ENTRIES = 200;

/** The message is addressable as a key too (§19.2), though it has its own slot. */
export const MESSAGE_KEY = "message";

// Keys already shown in a dedicated slot or never customer data (view.ts).
const HIDDEN_KEYS = new Set([
  "name",
  "phone",
  "email",
  "turnstile_token",
  "cf-turnstile-response",
  "_hp",
  "_original",
  "_original_cut",
]);

// Letters/digits first (so `__proto__` can never match), then a short list of
// separators real form builders use (`tipo_de_propiedad`, `fields[city]`,
// `Tipo de propiedad`).
const KEY_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _.\-[\]]{0,99}$/u;

export function isSaneFieldKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

const DICTIONARY_KEYS = new Set(Object.keys(es.app.leadData.fieldNames));

export type FieldLabelEntry = { key: string; label: string; prominent: boolean };

export type FieldLabelError =
  | "unknown"
  | "labelTooLong"
  | "keyInvalid"
  | "keyUnknown"
  | "tooMany"
  | "siteNotFound";

export type SaveFieldLabelsResult = { ok: true; changed: string[] } | { ok: false; error: FieldLabelError };

/** Distinct payload keys the site really sent, newest submissions first. */
export async function listSeenFieldKeys(ctx: TenantContext, siteId: string): Promise<string[]> {
  const rows = await tenantDb(ctx)
    .select(leadSubmissions, eq(leadSubmissions.siteId, siteId))
    .orderBy(desc(leadSubmissions.createdAt), desc(leadSubmissions.id))
    .limit(FIELD_KEY_SAMPLE_SIZE);

  const seen = new Set<string>();
  for (const row of rows) {
    const payload = row.payload;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) continue;
    for (const key of Object.keys(payload)) {
      if (HIDDEN_KEYS.has(key.toLowerCase()) || !isSaneFieldKey(key)) continue;
      seen.add(key);
    }
  }
  return [...seen];
}

export type SiteFieldRow = { key: string; label: string; prominent: boolean };

/**
 * What the editor lists for one site: the message, every key the site has
 * sent, and any key already configured (so a stale override can still be
 * cleared). Foreign or unknown site -> null.
 */
export async function getSiteFieldRows(
  ctx: TenantContext,
  siteId: string,
): Promise<SiteFieldRow[] | null> {
  const site = await getSite(ctx, siteId);
  if (!site) return null;
  const settings = siteSettings(site);
  const labels = settings.fieldLabels ?? {};
  const display = settings.fieldDisplay ?? {};

  const keys = new Set<string>([MESSAGE_KEY, ...(await listSeenFieldKeys(ctx, siteId))]);
  for (const key of [...Object.keys(labels), ...Object.keys(display)]) {
    if (isSaneFieldKey(key)) keys.add(key);
  }
  return [...keys].slice(0, MAX_FIELD_ENTRIES).map((key) => ({
    key,
    label: typeof labels[key] === "string" ? labels[key] : "",
    prominent: display[key]?.prominent === true,
  }));
}

export async function saveSiteFieldSettings(
  ctx: TenantContext,
  siteId: string,
  entries: FieldLabelEntry[],
): Promise<SaveFieldLabelsResult> {
  if (entries.length > MAX_FIELD_ENTRIES) return { ok: false, error: "tooMany" };

  const cleaned: FieldLabelEntry[] = [];
  for (const entry of entries) {
    const label = entry.label.trim();
    if (label.length > MAX_FIELD_LABEL_LENGTH) return { ok: false, error: "labelTooLong" };
    if (!isSaneFieldKey(entry.key)) return { ok: false, error: "keyInvalid" };
    cleaned.push({ key: entry.key, label, prominent: entry.prominent });
  }

  // Tenant-scoped lookup: a foreign id is the same not-found as a missing one.
  const site = await getSite(ctx, siteId);
  if (!site) return { ok: false, error: "siteNotFound" };

  const settings = siteSettings(site);
  const labels: Record<string, string> = { ...(settings.fieldLabels ?? {}) };
  const display: Record<string, { prominent: boolean }> = {};
  for (const [key, value] of Object.entries(settings.fieldDisplay ?? {})) {
    if (value?.prominent === true) display[key] = { prominent: true };
  }

  const allowed = new Set<string>([
    MESSAGE_KEY,
    ...DICTIONARY_KEYS,
    ...Object.keys(labels),
    ...Object.keys(display),
    ...(await listSeenFieldKeys(ctx, siteId)),
  ]);
  if (cleaned.some((entry) => !allowed.has(entry.key))) return { ok: false, error: "keyUnknown" };

  const changed: string[] = [];
  for (const { key, label, prominent } of cleaned) {
    const before = { label: labels[key] ?? "", prominent: display[key]?.prominent === true };
    if (label) labels[key] = label;
    else delete labels[key];
    if (prominent) display[key] = { prominent: true };
    else delete display[key];
    if (before.label !== label || before.prominent !== prominent) changed.push(key);
  }
  if (changed.length === 0) return { ok: true, changed };

  await mergeSiteSettings(ctx, siteId, {
    fieldLabels: Object.keys(labels).length ? labels : undefined,
    fieldDisplay: Object.keys(display).length ? display : undefined,
  });
  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    impersonatorUserId: ctx.impersonatorUserId,
    action: "site.field_labels.update",
    entity: "site",
    entityId: siteId,
    payload: { changedKeys: changed },
  });
  return { ok: true, changed };
}
