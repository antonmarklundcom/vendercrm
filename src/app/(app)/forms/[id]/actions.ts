"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAdmin } from "@/modules/tenancy/context";
import { getForm, hasFormSubmissions, updateForm } from "@/modules/forms/forms";
import {
  assertKeysNotRenamed,
  validateFormFields,
  FormFieldsInvalidError,
  type FormField,
} from "@/modules/forms/field-definitions";
import { listCustomFieldDefinitions } from "@/modules/crm/custom-fields";

// Forms field editor (PLAN.md §17.3 "P15/P17" P17 half). One action posts
// the whole field list as JSON — the editor is a "use client" component
// already (add/remove/reorder need client state), so this skips reinventing
// per-row indexed form fields for no progressive-enhancement benefit.

export type FieldEditorState = { error: string | null };

type PostedRow = FormField & { originalKey: string | null };

export async function updateFormFieldsAction(
  formId: string,
  _prevState: FieldEditorState,
  formData: FormData,
): Promise<FieldEditorState> {
  const ctx = await requireTenantAdmin();

  const form = await getForm(ctx, formId);
  if (!form) return { error: "unknown" };

  let rows: PostedRow[];
  try {
    rows = JSON.parse(String(formData.get("fieldsJson") ?? "[]"));
  } catch {
    return { error: "invalid" };
  }

  const customFieldKeys = (await listCustomFieldDefinitions(ctx)).map((d) => d.key);

  let fields: FormField[];
  try {
    const rawFields: FormField[] = rows.map((row) => ({
      key: row.key,
      label: row.label,
      type: row.type,
      required: row.required,
      options: row.options,
      mapTo: row.mapTo,
    }));
    fields = validateFormFields(rawFields, customFieldKeys);

    if (await hasFormSubmissions(ctx, formId)) {
      assertKeysNotRenamed(rows);
    }
  } catch (err) {
    if (err instanceof FormFieldsInvalidError) return { error: err.code };
    throw err;
  }

  await updateForm(ctx, formId, { fields });
  revalidatePath(`/forms/${formId}`);
  return { error: null };
}
