"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { DEFAULT_COUNTRY } from "@/lib/phone";
import { listCustomFieldDefinitions } from "@/modules/crm/custom-fields";
import {
  IMPORTABLE_FIELDS,
  guessMapping,
  importContacts,
  parseCsv,
  type ImportMapping,
  type ImportReport,
} from "@/modules/crm/import";

// Two-step import (PLAN.md §13 H6). The CSV text travels with the form
// between the steps rather than being parked in a session or on disk: an
// import that fails halfway leaves nothing behind to clean up, and nothing
// of the tenant's data sits anywhere outside the request.

// A "use server" module may only export async functions, so the initial
// states live in the client component; this local copy is what the action
// spreads its refusals over.
const EMPTY_PREVIEW = {
  error: null,
  csv: null,
  headers: [] as string[],
  rowCount: 0,
  sample: [] as Record<string, string>[],
  mapping: {} as ImportMapping,
};

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

export type PreviewState = {
  error: string | null;
  csv: string | null;
  headers: string[];
  rowCount: number;
  sample: Record<string, string>[];
  mapping: ImportMapping;
};

export async function previewImportAction(
  _prevState: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  await requireTenantContext();

  const file = formData.get("file");
  const pasted = String(formData.get("pasted") ?? "").trim();

  let text = pasted;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CSV_BYTES) return { ...EMPTY_PREVIEW, error: "tooLarge" };
    text = await file.text();
  }

  if (!text) return { ...EMPTY_PREVIEW, error: "empty" };

  const { headers, rows } = parseCsv(text);
  if (headers.length === 0 || rows.length === 0) return { ...EMPTY_PREVIEW, error: "empty" };
  if (rows.length > MAX_ROWS) return { ...EMPTY_PREVIEW, error: "tooManyRows" };

  return {
    error: null,
    csv: text,
    headers,
    rowCount: rows.length,
    sample: rows.slice(0, 5),
    mapping: guessMapping(headers),
  };
}

export type ImportState = {
  error: string | null;
  report: ImportReport | null;
};

const runSchema = z.object({
  csv: z.string().min(1),
  onDuplicate: z.enum(["update", "skip"]),
  tagId: z.string().max(26).optional(),
});

export async function runImportAction(
  _prevState: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const ctx = await requireTenantContext();

  const parsed = runSchema.safeParse({
    csv: formData.get("csv"),
    onDuplicate: formData.get("onDuplicate"),
    tagId: formData.get("tagId") || undefined,
  });
  if (!parsed.success) return { error: "invalid", report: null };

  const mapping: ImportMapping = {};
  for (const field of IMPORTABLE_FIELDS) {
    const header = String(formData.get(`map_${field}`) ?? "").trim();
    if (header) mapping[field] = header;
  }
  if (!mapping.phone) return { error: "phoneUnmapped", report: null };
  if (!mapping.name) return { error: "nameUnmapped", report: null };

  const customDefinitions = await listCustomFieldDefinitions(ctx);
  if (customDefinitions.length > 0) {
    mapping.custom = {};
    for (const definition of customDefinitions) {
      const header = String(formData.get(`map_custom_${definition.key}`) ?? "").trim();
      if (header) mapping.custom[definition.key] = header;
    }
  }

  const { rows } = parseCsv(parsed.data.csv);
  if (rows.length === 0) return { error: "empty", report: null };

  const tenant = await getTenant(ctx.tenantId);
  const settings = (tenant?.settings ?? {}) as TenantSettings;

  const report = await importContacts(ctx, rows, {
    mapping,
    onDuplicate: parsed.data.onDuplicate,
    tagId: parsed.data.tagId,
    defaultCountry: settings.defaultCountry ?? DEFAULT_COUNTRY,
  });

  revalidatePath("/contacts");
  return { error: null, report };
}
