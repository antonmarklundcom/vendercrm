import { asc, eq } from "drizzle-orm";
import { customFieldDefinitions } from "@/db/schema";
import { newId } from "@/lib/ids";
import { slugify } from "@/lib/slug";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";

// Tenant-defined contact fields (PLAN.md §15.5 J4, §15.8 P5). Values live in
// `contacts.custom`; this module owns the field *definitions* — what keys
// exist, their type, and how they render.

export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select", "phone"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect;

export type CreateCustomFieldInput = {
  key?: string;
  label: string;
  type: CustomFieldType;
  options?: string[];
  required?: boolean;
  showOnCard?: boolean;
};

export async function listCustomFieldDefinitions(
  ctx: TenantContext,
): Promise<CustomFieldDefinition[]> {
  return tenantDb(ctx)
    .select(customFieldDefinitions)
    .orderBy(asc(customFieldDefinitions.position));
}

export class CustomFieldKeyTakenError extends Error {
  constructor() {
    super("custom_field_key_taken");
  }
}

/** `key` is slugified from the label when not given, then locked in — see
 *  the schema comment on why it is never rewritten once created. */
export async function createCustomFieldDefinition(
  ctx: TenantContext,
  input: CreateCustomFieldInput,
): Promise<CustomFieldDefinition | null> {
  const key = slugify(input.key || input.label).replace(/-/g, "_").slice(0, 64);

  const existing = await tenantDb(ctx)
    .select(customFieldDefinitions, eq(customFieldDefinitions.key, key))
    .limit(1);
  if (existing.length > 0) throw new CustomFieldKeyTakenError();

  const all = await listCustomFieldDefinitions(ctx);
  const id = newId();
  await tenantDb(ctx)
    .insert(customFieldDefinitions)
    .values({
      id,
      key,
      label: input.label,
      type: input.type,
      options: input.type === "select" ? (input.options ?? []) : [],
      position: all.length,
      required: input.required ?? false,
      showOnCard: input.showOnCard ?? false,
    });

  const [row] = await tenantDb(ctx).select(customFieldDefinitions, eq(customFieldDefinitions.id, id));
  return row ?? null;
}

export type UpdateCustomFieldInput = Partial<
  Pick<CreateCustomFieldInput, "label" | "options" | "required" | "showOnCard">
>;

/** `key` and `type` are not editable — changing either would strand every
 *  contact's already-stored value (the type mismatch, or the orphaned old
 *  key). Delete and recreate is the path for "I set this up wrong". */
export async function updateCustomFieldDefinition(
  ctx: TenantContext,
  id: string,
  input: UpdateCustomFieldInput,
): Promise<void> {
  await tenantDb(ctx)
    .update(customFieldDefinitions)
    .set(input)
    .where(eq(customFieldDefinitions.id, id));
}

export async function deleteCustomFieldDefinition(ctx: TenantContext, id: string): Promise<void> {
  await tenantDb(ctx).delete(customFieldDefinitions, eq(customFieldDefinitions.id, id));
}

/** Coerces a raw string (a form field, a CSV cell) to what the field's type
 *  should store in `contacts.custom`. Never throws — an unparseable number
 *  or date is dropped rather than failing the whole save/import row, the
 *  same "skip, don't block" rule the CSV importer already follows. */
export function coerceCustomFieldValue(
  definition: Pick<CustomFieldDefinition, "type" | "options">,
  raw: string,
): string | number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  switch (definition.type) {
    case "number": {
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    }
    case "date": {
      const d = new Date(trimmed);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    case "select": {
      const options = (definition.options as string[] | null) ?? [];
      return options.includes(trimmed) ? trimmed : null;
    }
    default:
      return trimmed;
  }
}

/**
 * `{{contacto.custom.<key>}}` substitution (§15.8 P5) — the resolver the
 * automation template engine can register, kept here since P5 does not own
 * modules/automations. `renderTemplateVars` (automations/actions.ts) handles
 * `{{contact.name}}`/`{{contact.phone}}` today; this is the equivalent for
 * custom fields, exposed for whichever call site wires it in.
 */
export function renderContactCustomVars(
  text: string,
  custom: Record<string, unknown> | null | undefined,
): string {
  if (!custom) return text;
  return text.replace(/\{\{\s*contacto\.custom\.([a-z0-9_]+)\s*\}\}/gi, (match, key: string) => {
    const value = custom[key];
    return value === undefined || value === null ? "" : String(value);
  });
}
