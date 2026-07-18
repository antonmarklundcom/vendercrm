"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { FormField } from "@/db/schema/forms";

const FIELD_TYPES: FormField["type"][] = ["text", "phone", "email", "select", "textarea"];

export function FormFieldsEditor({
  name,
  initialFields,
}: {
  name: string;
  initialFields: FormField[];
}) {
  const [fields, setFields] = useState<FormField[]>(
    initialFields.length > 0
      ? initialFields
      : [{ key: "name", label: "Nombre", type: "text", required: true }],
  );

  function updateField(index: number, patch: Partial<FormField>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  function addField() {
    setFields((prev) => [
      ...prev,
      { key: `campo_${prev.length + 1}`, label: "Nuevo campo", type: "text", required: false },
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name={name} value={JSON.stringify(fields)} />

      {fields.map((field, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
          <label className="flex flex-col gap-1 text-xs">
            Clave
            <input
              value={field.key}
              onChange={(e) => updateField(i, { key: e.target.value })}
              className="w-32 rounded-md border border-input bg-background px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Etiqueta
            <input
              value={field.label}
              onChange={(e) => updateField(i, { label: e.target.value })}
              className="w-40 rounded-md border border-input bg-background px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Tipo
            <select
              value={field.type}
              onChange={(e) => updateField(i, { type: e.target.value as FormField["type"] })}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(e) => updateField(i, { required: e.target.checked })}
            />
            Obligatorio
          </label>
          <Button type="button" variant="outline" size="sm" onClick={() => removeField(i)}>
            Quitar
          </Button>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" className="self-start" onClick={addField}>
        Agregar campo
      </Button>
    </div>
  );
}
