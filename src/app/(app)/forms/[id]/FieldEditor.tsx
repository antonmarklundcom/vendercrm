"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-fields";
import { updateFormFieldsAction, type FieldEditorState } from "./actions";
import type { FormField, FormFieldType } from "@/modules/forms/field-definitions";
import { FORM_FIELD_TYPES, slugifyFieldKey } from "@/modules/forms/field-definitions";

const initialState: FieldEditorState = { error: null };

type EditableField = FormField & { originalKey: string | null };

function toEditable(field: FormField): EditableField {
  return { ...field, originalKey: field.key };
}

let nextTempId = 0;

function blankField(): EditableField {
  nextTempId += 1;
  return {
    key: `__new_${nextTempId}`,
    label: "",
    type: "text",
    required: false,
    originalKey: null,
  };
}

export function FieldEditor({
  formId,
  fields,
  locked,
  customFields,
}: {
  formId: string;
  fields: FormField[];
  /** The form has at least one submission — a surviving field's key can no
   *  longer be edited, since submissions and mapped custom values are keyed
   *  by it. */
  locked: boolean;
  customFields: Array<{ key: string; label: string }>;
}) {
  const t = useTranslations("app.forms.editor");
  const [rows, setRows] = useState<EditableField[]>(() => fields.map(toEditable));
  const boundAction = updateFormFieldsAction.bind(null, formId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  function update(index: number, patch: Partial<EditableField>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function move(index: number, direction: -1 | 1) {
    setRows((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function remove(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function add() {
    setRows((prev) => [...prev, blankField()]);
  }

  const fieldsJson = JSON.stringify(
    rows.map((row) => ({
      ...row,
      // A brand-new row's key is derived from its label at submit time —
      // typing the label is the only thing the operator does for it.
      key: row.originalKey ?? slugifyFieldKey("", row.label || row.key),
    })),
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="fieldsJson" value={fieldsJson} />
      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const keyLocked = locked && row.originalKey !== null;
          return (
            <li key={row.originalKey ?? row.key} className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  {t("label")}
                  <Input
                    value={row.label}
                    onChange={(e) => update(index, { label: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("type")}
                  <Select
                    value={row.type}
                    disabled={keyLocked}
                    onChange={(e) => update(index, { type: e.target.value as FormFieldType })}
                  >
                    {FORM_FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`types.${type}`)}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={row.required}
                    onChange={(e) => update(index, { required: e.target.checked })}
                  />
                  {t("required")}
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("mapTo")}
                  <Select
                    value={row.mapTo ?? ""}
                    onChange={(e) => update(index, { mapTo: e.target.value || undefined })}
                  >
                    <option value="">{t("mapToNone")}</option>
                    {customFields.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              {row.type === "select" && (
                <label className="flex flex-col gap-1 text-sm">
                  {t("options")}
                  <Input
                    value={(row.options ?? []).join(", ")}
                    onChange={(e) =>
                      update(index, {
                        options: e.target.value
                          .split(",")
                          .map((o) => o.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  {t("moveUp")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                >
                  {t("moveDown")}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => remove(index)}>
                  {t("remove")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <Button type="button" variant="outline" className="w-fit" onClick={add}>
        {t("addField")}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${state.error}` as "errors.invalid")}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-fit">
        {t("save")}
      </Button>
    </form>
  );
}
