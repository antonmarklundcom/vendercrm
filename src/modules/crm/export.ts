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
import { buildCsv, CSV_BOM } from "@/lib/csv";

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
 * CSV body for the three export routes (contacts, products, reports), built
 * with the shared lib/csv.ts builder so formula-injection neutralization
 * (including E.164 phones, which would otherwise be evaluated as numbers),
 * RFC 4180 quoting and CRLF rows are defined in one place.
 *
 * The shared builder prefixes a UTF-8 BOM; it is stripped here because each
 * route adds the BOM itself (the contacts feed for Sheets' IMPORTDATA
 * deliberately has none).
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return buildCsv(headers, rows).slice(CSV_BOM.length);
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
