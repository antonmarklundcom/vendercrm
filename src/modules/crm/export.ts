import type { TenantContext } from "@/modules/tenancy/context";
import { listTags } from "./contacts";
import {
  queryContacts,
  type ContactListOptions,
  type ContactQuery,
} from "./contact-list";
import { listCustomFieldDefinitions } from "./custom-fields";
import { listTenantUsers } from "@/modules/tenancy/users";
import { tenantDb } from "@/modules/tenancy/db";
import { contactTags } from "@/db/schema";

// Contact export (CSV). Two consumers, one row shape: the download button in
// /contacts, and the tokened feed Google Sheets pulls with IMPORTDATA.

export const CONTACT_EXPORT_COLUMNS = [
  "nombre",
  "telefono",
  "email",
  "origen",
  "etiquetas",
  "responsable",
  "notas",
  "creado",
] as const;

/**
 * Neutralizes spreadsheet formula injection. A cell beginning with `=`, `+`,
 * `-` or `@` is executed as a formula by Sheets and Excel, which is both a
 * security problem (a contact named `=IMPORTXML(...)` exfiltrates data when
 * an admin opens the file) and, here, a correctness one: **every Paraguayan
 * phone is E.164**, so `+595981234567` would otherwise be evaluated as the
 * number 595981234567 and lose its formatting. The leading apostrophe is the
 * standard "treat as text" marker — Sheets hides it, Excel shows it.
 */
function neutralize(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = value instanceof Date ? value.toISOString() : String(value);
  const safe = neutralize(raw);
  // Quote whenever the value could otherwise break the row apart.
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCell).join(","))
    // CRLF per RFC 4180 — what Excel expects; Sheets accepts either.
    .join("\r\n");
}

/**
 * Contacts with their tags and owner resolved, honoring the same filters the
 * /contacts list uses so "export" always means "what I'm looking at".
 */
export async function exportContactsCsv(
  ctx: TenantContext,
  query: ContactQuery = {},
  options: ContactListOptions = {},
): Promise<string> {
  // Sort order carries over so the file opens in the order the rep was
  // looking at, but pagination does not — an export is the whole filtered
  // set, not the page that happened to be on screen.
  const [page, tags, users, links, customFields] = await Promise.all([
    queryContacts(ctx, query, {
      ...options,
      page: 1,
      perPage: Number.MAX_SAFE_INTEGER,
    }),
    listTags(ctx),
    listTenantUsers(ctx),
    tenantDb(ctx).select(contactTags),
    listCustomFieldDefinitions(ctx),
  ]);

  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));
  const userNames = new Map(users.map((user) => [user.id, user.name]));

  const tagsByContact = new Map<string, string[]>();
  for (const link of links) {
    const name = tagNames.get(link.tagId);
    if (!name) continue;
    const existing = tagsByContact.get(link.contactId);
    if (existing) existing.push(name);
    else tagsByContact.set(link.contactId, [name]);
  }

  const rows = page.rows.map((contact) => {
    const custom = (contact.custom as Record<string, unknown>) ?? {};
    return [
      contact.name,
      contact.phone,
      contact.email ?? "",
      contact.source ?? "",
      (tagsByContact.get(contact.id) ?? []).join(" | "),
      contact.ownerUserId ? (userNames.get(contact.ownerUserId) ?? "") : "",
      contact.notes ?? "",
      contact.createdAt,
      ...customFields.map((field) => custom[field.key] ?? ""),
    ];
  });

  const headers = [...CONTACT_EXPORT_COLUMNS, ...customFields.map((field) => field.label)];
  return toCsv(headers, rows);
}
