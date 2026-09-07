"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form-fields";
import type { TemplateFormState } from "../actions";

const initialState: TemplateFormState = { error: null };

export type TemplateFormLabels = {
  name: string;
  body: string;
  bodyHint: string;
  active: string;
  save: string;
  create: string;
  errors: { invalid: string; unknownVariable: string };
};

/** One template's editor, or the blank create form when `defaults` is
 *  omitted (PLAN.md §17.2 P13). A save that references an unknown
 *  `{{variable}}` is refused with the variable's own name (§17.3). */
export function TemplateForm({
  action,
  defaults,
  labels,
}: {
  action: (state: TemplateFormState, formData: FormData) => Promise<TemplateFormState>;
  defaults?: { templateId: string; name: string; body: string; isActive: boolean };
  labels: TemplateFormLabels;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border p-4">
      {defaults && <input type="hidden" name="templateId" value={defaults.templateId} />}

      <label className="flex flex-col gap-1 text-sm">
        {labels.name}
        <Input name="name" required maxLength={200} defaultValue={defaults?.name} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {labels.body}
        <Textarea name="body" required rows={10} defaultValue={defaults?.body} />
      </label>
      <p className="text-xs text-muted-foreground">{labels.bodyHint}</p>

      {defaults && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={defaults.isActive} />
          {labels.active}
        </label>
      )}

      <Button type="submit" disabled={pending} className="w-fit">
        {defaults ? labels.save : labels.create}
      </Button>

      {state.error && (
        <span role="alert" className="text-xs text-destructive">
          {state.error === "unknownVariable" && state.variable
            ? `${labels.errors.unknownVariable}: {{${state.variable}}}`
            : labels.errors.invalid}
        </span>
      )}
    </form>
  );
}
