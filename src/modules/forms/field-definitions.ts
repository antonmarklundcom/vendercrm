import { z } from "zod";
import { slugify } from "@/lib/slug";

// Forms field editor (PLAN.md §4 "forms", §17.3 "P15/P17" P17 half). This
// module owns the *shape* of a form's field list — validation shared by the
// editor action and (indirectly, via the same zod schema) anything else
// that ever needs to sanity-check a `forms.fields` JSON blob.

export const FORM_FIELD_TYPES = [
  "text",
  "phone",
  "email",
  "select",
  "textarea",
  "checkbox",
  "date",
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export type FormField = {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
  /** A P5 custom-field key this answer is written into on submission
   *  (`contacts.custom`), validated against the tenant's own definitions —
   *  never a raw label a typo could silently drop. */
  mapTo?: string;
};

const rawFieldSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean(),
  options: z.array(z.string().min(1).max(200)).optional(),
  mapTo: z.string().min(1).max(64).optional(),
});

export class FormFieldsInvalidError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Slugifies a raw key (or falls back to the label) — the same convention
 *  P5's custom-field keys use (`custom-fields.ts`), so a form field's key
 *  and a `mapTo` custom-field key are never subtly different slug shapes. */
export function slugifyFieldKey(rawKey: string, label: string): string {
  return slugify(rawKey || label).replace(/-/g, "_").slice(0, 64);
}

/**
 * Validates a full field list before it's saved: every field parses, keys
 * are unique, exactly one field is a *required* `phone` field (contact
 * identity, §5), every `select` field has at least one option, and every
 * `mapTo` names a custom field the tenant actually has.
 */
export function validateFormFields(fields: unknown, customFieldKeys: string[]): FormField[] {
  let parsed: FormField[];
  try {
    parsed = z.array(rawFieldSchema).min(1).parse(fields) as FormField[];
  } catch {
    throw new FormFieldsInvalidError("invalid");
  }

  const seenKeys = new Set<string>();
  let requiredPhoneCount = 0;
  for (const field of parsed) {
    if (seenKeys.has(field.key)) throw new FormFieldsInvalidError("duplicate_key");
    seenKeys.add(field.key);

    if (field.type === "phone" && field.required) requiredPhoneCount += 1;
    if (field.type === "select" && !(field.options && field.options.length > 0)) {
      throw new FormFieldsInvalidError("select_needs_options");
    }
    if (field.mapTo && !customFieldKeys.includes(field.mapTo)) {
      throw new FormFieldsInvalidError("map_to_unknown");
    }
  }
  if (requiredPhoneCount !== 1) throw new FormFieldsInvalidError("phone_required");

  return parsed;
}

/**
 * Server-side re-validation of a public submission against the form's own
 * field definitions (§5): a required field left empty or a `select` answer
 * outside its own options throws, the same way `phone_required` already
 * does for the one field every form has always required.
 */
export function validateSubmissionData(
  fields: FormField[],
  data: Record<string, string | undefined>,
): void {
  for (const field of fields) {
    const value = data[field.key];
    if (field.required && !value) {
      throw new FormFieldsInvalidError(`field_required:${field.key}`);
    }
    if (field.type === "select" && value && !(field.options ?? []).includes(value)) {
      throw new FormFieldsInvalidError(`invalid_option:${field.key}`);
    }
  }
}

/**
 * Refuses to change the `key` of a surviving field once the form has at
 * least one submission — those submissions' payloads and any already-mapped
 * `contacts.custom` values are keyed by it (P5's same "key never renamed"
 * rule, applied here to forms). The editor tags each posted row with the
 * key it started as (`null` for a newly added row, which is always fine);
 * only a row whose key changed out from under an existing one is refused.
 */
export function assertKeysNotRenamed(
  rows: Array<{ originalKey: string | null; key: string }>,
): void {
  for (const row of rows) {
    if (row.originalKey && row.originalKey !== row.key) {
      throw new FormFieldsInvalidError("key_immutable");
    }
  }
}
