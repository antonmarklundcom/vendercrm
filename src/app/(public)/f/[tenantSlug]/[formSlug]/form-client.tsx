"use client";

import { useActionState } from "react";
import { submitFormAction, type SubmitState } from "./actions";
import type { FormField } from "@/modules/forms/service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: SubmitState = { status: "idle" };

export function PublicFormClient({
  tenantSlug,
  formSlug,
  name,
  fields,
}: {
  tenantSlug: string;
  formSlug: string;
  name: string;
  fields: FormField[];
}) {
  const [state, action, pending] = useActionState(submitFormAction, initial);

  if (state.status === "ok") {
    return (
      <div className="rounded-lg border p-6 text-center">
        <p className="font-medium">¡Gracias! Recibimos tu mensaje.</p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="__tenant" value={tenantSlug} />
      <input type="hidden" name="__form" value={formSlug} />
      {/* Honeypot — hidden from humans, tempting to bots. */}
      <input
        type="text"
        name="__hp"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden="true"
      />
      <h1 className="text-xl font-semibold">{name}</h1>
      {fields.map((field) => (
        <div key={field.key} className="grid gap-1.5">
          <Label htmlFor={field.key}>
            {field.label}
            {field.required && <span className="text-destructive"> *</span>}
          </Label>
          {field.type === "textarea" ? (
            <textarea
              id={field.key}
              name={field.key}
              required={field.required}
              className="min-h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
          ) : field.type === "select" ? (
            <select
              id={field.key}
              name={field.key}
              required={field.required}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">—</option>
              {(field.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={field.key}
              name={field.key}
              type={
                field.type === "email"
                  ? "email"
                  : field.type === "phone"
                    ? "tel"
                    : "text"
              }
              required={field.required}
            />
          )}
        </div>
      ))}
      {state.status === "error" && (
        <p className="text-sm text-destructive">{state.message}</p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Enviando…" : "Enviar"}
      </Button>
    </form>
  );
}
