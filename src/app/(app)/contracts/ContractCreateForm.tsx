"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form-fields";
import type { ContractFormState } from "./actions";

const initialState: ContractFormState = { error: null };

export type CreateFormLabels = {
  contact: string;
  template: string;
  submit: string;
  errors: Record<string, string>;
};

/** "Nuevo contrato" (PLAN.md §17.2 P13) — a contact and a template is all a
 *  contract needs; dealId/quoteId ride along as hidden defaults when this
 *  page was reached from a deal or quote's "generar contrato" link. */
export function ContractCreateForm({
  action,
  contacts,
  templates,
  defaults,
  labels,
}: {
  action: (state: ContractFormState, formData: FormData) => Promise<ContractFormState>;
  contacts: Array<{ id: string; label: string }>;
  templates: Array<{ id: string; name: string }>;
  defaults: { contactId: string; dealId: string; quoteId: string };
  labels: CreateFormLabels;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      {defaults.dealId && <input type="hidden" name="dealId" value={defaults.dealId} />}
      {defaults.quoteId && <input type="hidden" name="quoteId" value={defaults.quoteId} />}

      <label className="flex flex-col gap-1 text-sm">
        {labels.contact}
        <Select name="contactId" required defaultValue={defaults.contactId}>
          <option value="" disabled>
            {labels.contact}
          </option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.label}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {labels.template}
        <Select name="templateId" required defaultValue={templates[0]?.id ?? ""}>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </Select>
      </label>

      <Button type="submit" disabled={pending} className="w-fit">
        {labels.submit}
      </Button>

      {state.error && (
        <span role="alert" className="text-xs text-destructive">
          {labels.errors[state.error] ?? labels.errors.invalid}
        </span>
      )}
    </form>
  );
}
