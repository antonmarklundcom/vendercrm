"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { submitPublicFormAction, type PublicFormActionState } from "@/modules/forms/public-actions";
import type { FormField } from "@/db/schema/forms";

const initialState: PublicFormActionState = { status: "idle" };

export function PublicFormRenderer({
  tenantSlug,
  formSlug,
  fields,
}: {
  tenantSlug: string;
  formSlug: string;
  fields: FormField[];
}) {
  const action = submitPublicFormAction.bind(null, tenantSlug, formSlug);
  const [state, formAction, pending] = useActionState(action, initialState);

  if (state.status === "ok") {
    return (
      <div className="rounded-lg border border-border p-6 text-center">
        <p className="font-medium">¡Gracias! Recibimos tu información.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {fields.map((field) => (
        <label key={field.key} className="flex flex-col gap-1 text-sm">
          {field.label}
          {field.type === "textarea" ? (
            <textarea
              name={field.key}
              required={field.required}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          ) : field.type === "select" ? (
            <select
              name={field.key}
              required={field.required}
              className="rounded-md border border-input bg-background px-3 py-2"
            >
              {(field.options ?? []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={field.type === "phone" ? "tel" : field.type}
              name={field.key}
              required={field.required}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          )}
        </label>
      ))}

      {/* Honeypot: hidden from real users via CSS, not `type=hidden`, so bots
          that fill every visible-looking field still get caught. */}
      <input
        type="text"
        name="_hp"
        tabIndex={-1}
        autoComplete="off"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
        aria-hidden="true"
      />

      {state.status === "error" && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Enviando..." : "Enviar"}
      </Button>
    </form>
  );
}
