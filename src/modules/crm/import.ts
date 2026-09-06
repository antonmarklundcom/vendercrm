import { z } from "zod";
import { DEFAULT_COUNTRY, normalizePhone, type CountryCode } from "@/lib/phone";
import type { TenantContext } from "@/modules/tenancy/context";
import { checkPlanLimit } from "@/modules/tenancy/limits";
import { IMPORTABLE_FIELDS, type ImportableField, type ImportMapping } from "./import-fields";
import {
  addTagToContact,
  createContact,
  getContactByPhone,
  updateContact,
} from "./contacts";
import { coerceCustomFieldValue, listCustomFieldDefinitions } from "./custom-fields";

// Contact CSV import (PLAN.md §13 H6) — the GHL migration path (§1.1). The
// parser is deliberately hand-written rather than a dependency: the format
// this has to survive is "whatever the old CRM exported", which means quoted
// fields with commas and newlines in them, a UTF-8 BOM from Excel, and CRLF
// line endings. That is the whole of RFC 4180, and it is 60 lines.

export {
  IMPORTABLE_FIELDS,
  type ImportableField,
  type ImportMapping,
} from "./import-fields";

export type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
};

export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];

    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Swallow the \n of a \r\n pair rather than emitting a blank record.
      if (char === "\r" && clean[i + 1] === "\n") i += 1;
      record.push(field);
      records.push(record);
      field = "";
      record = [];
    } else {
      field += char;
    }
  }

  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((value) => value.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] ?? "").trim();
    });
    return row;
  });

  return { headers, rows };
}

/**
 * First guess at the mapping, so the common export lands pre-filled and the
 * user only corrects it. Covers the Spanish and English headers the two
 * sources that matter emit: GoHighLevel (§1.1) and a hand-made spreadsheet.
 */
const HEADER_HINTS: Record<ImportableField, string[]> = {
  name: ["name", "full name", "first name", "nombre", "nombre completo", "contacto", "cliente"],
  phone: ["phone", "phone number", "mobile", "telefono", "teléfono", "celular", "whatsapp"],
  email: ["email", "e-mail", "correo", "correo electrónico", "correo electronico"],
  notes: ["notes", "note", "notas", "observaciones", "comentario", "mensaje"],
  source: ["source", "origen", "fuente", "campaign", "campaña"],
};

export function guessMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const used = new Set<string>();

  for (const field of IMPORTABLE_FIELDS) {
    const hints = HEADER_HINTS[field];
    const match = headers.find(
      (header) => !used.has(header) && hints.includes(header.trim().toLowerCase()),
    );
    if (match) {
      mapping[field] = match;
      used.add(match);
    }
  }

  return mapping;
}

export type DuplicateStrategy = "update" | "skip";

export type ImportOptions = {
  mapping: ImportMapping;
  onDuplicate: DuplicateStrategy;
  /** Applied to every contact the import touches, new or updated. */
  tagId?: string;
  defaultCountry?: CountryCode;
  source?: string;
};

export type ImportRowError = {
  /** 1-based row number as the user sees it in their spreadsheet (the
   * header is row 1), so "row 348 has no phone" points at row 348. */
  row: number;
  reason: "phoneMissing" | "phoneInvalid" | "nameMissing" | "duplicateInFile" | "failed";
};

export type ImportReport = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportRowError[];
  /** Set when the plan's contact ceiling stopped the run before it started. */
  limitReached?: { limit: number; current: number };
};

const emailSchema = z.string().email().max(320);

/**
 * Imports parsed rows. Dedupe is by normalized phone, both against the
 * tenant's existing contacts and within the file itself — a spreadsheet
 * that lists the same number twice is the normal case, not the exception.
 */
export async function importContacts(
  ctx: TenantContext,
  rows: Record<string, string>[],
  options: ImportOptions,
): Promise<ImportReport> {
  const country = options.defaultCountry ?? DEFAULT_COUNTRY;
  const report: ImportReport = {
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  // Asked once for the whole file rather than per row: a 1k-row import
  // against a 500-contact plan should say so before writing anything.
  const limit = await checkPlanLimit(ctx.tenantId, "maxContacts", rows.length);
  if (!limit.allowed && limit.limit !== null) {
    report.limitReached = { limit: limit.limit, current: limit.current };
    return report;
  }

  const seen = new Set<string>();
  const customDefinitions = await listCustomFieldDefinitions(ctx);

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2; // +1 for zero-based, +1 for the header row
    const value = (field: ImportableField) => {
      const header = options.mapping[field];
      return header ? (row[header] ?? "").trim() : "";
    };

    const rawPhone = value("phone");
    if (!rawPhone) {
      report.errors.push({ row: rowNumber, reason: "phoneMissing" });
      continue;
    }

    let phone: string;
    try {
      phone = normalizePhone(rawPhone, country);
    } catch {
      report.errors.push({ row: rowNumber, reason: "phoneInvalid" });
      continue;
    }
    // normalizePhone keeps whatever digits it was given; a value with none
    // of them is a header row that slipped through or a stray note.
    if (phone.replace(/\D/g, "").length < 6) {
      report.errors.push({ row: rowNumber, reason: "phoneInvalid" });
      continue;
    }

    if (seen.has(phone)) {
      report.errors.push({ row: rowNumber, reason: "duplicateInFile" });
      continue;
    }
    seen.add(phone);

    const name = value("name");
    if (!name) {
      report.errors.push({ row: rowNumber, reason: "nameMissing" });
      continue;
    }

    const rawEmail = value("email");
    const email = rawEmail && emailSchema.safeParse(rawEmail).success ? rawEmail : undefined;
    const notes = value("notes") || undefined;
    const source = value("source") || options.source || "import:csv";

    // Custom field values, coerced per the field's own type — an unparseable
    // number or date is dropped for that one field rather than failing the
    // whole row (the same "skip, don't block" rule the rest of this importer
    // follows).
    const custom: Record<string, string | number | null> = {};
    for (const definition of customDefinitions) {
      const header = options.mapping.custom?.[definition.key];
      if (!header) continue;
      const raw = (row[header] ?? "").trim();
      if (!raw) continue;
      custom[definition.key] = coerceCustomFieldValue(definition, raw);
    }

    try {
      const existing = await getContactByPhone(ctx, phone, country);

      if (existing) {
        if (options.onDuplicate === "skip") {
          report.skipped += 1;
          continue;
        }

        // Update fills gaps and refreshes what the file carries; it never
        // blanks a field the CSV left empty.
        await updateContact(
          ctx,
          existing.id,
          {
            name,
            ...(email ? { email } : {}),
            ...(notes ? { notes } : {}),
            ...(Object.keys(custom).length > 0 ? { custom } : {}),
          },
          country,
        );
        if (options.tagId) await addTagToContact(ctx, existing.id, options.tagId);
        report.updated += 1;
        continue;
      }

      const created = await createContact(ctx, { name, phone, email, notes, source, custom }, country);
      if (created && options.tagId) await addTagToContact(ctx, created.id, options.tagId);
      report.created += 1;
    } catch {
      report.errors.push({ row: rowNumber, reason: "failed" });
    }
  }

  return report;
}
