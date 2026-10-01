"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-fields";
import { saveSiteFieldLabelsAction, type FieldLabelsFormState } from "./actions";

// "Campos del formulario" (PLAN.md §19.2, L3): per site, the keys it has
// sent, an editable label (the auto label is the placeholder) and a
// "Destacar" toggle. Everything is plain text: values go into inputs and
// React children only — no raw-HTML escape hatch in this file.

export type FieldLabelsPanelLabels = {
  title: string;
  intro: string;
  empty: string;
  key: string;
  label: string;
  prominent: string;
  save: string;
  saved: string;
  messageKey: string;
  errors: Record<string, string>;
};

export type FieldLabelsRow = {
  key: string;
  label: string;
  prominent: boolean;
  /** The label the card shows when no override is set. */
  autoLabel: string;
};

const initialState: FieldLabelsFormState = { error: null, saved: false };

export function SiteFieldLabelsForm({
  siteId,
  rows,
  labels,
  maxLength,
}: {
  siteId: string;
  rows: FieldLabelsRow[];
  labels: FieldLabelsPanelLabels;
  maxLength: number;
}) {
  const [state, formAction, pending] = useActionState(saveSiteFieldLabelsAction, initialState);

  return (
    <details className="rounded-md border px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none">{labels.title}</summary>
      <p className="mt-2 text-muted-foreground">{labels.intro}</p>

      {rows.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{labels.empty}</p>
      ) : (
        <form action={formAction} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="siteId" value={siteId} />
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li
                key={row.key}
                className="flex min-w-0 flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-end"
              >
                <input type="hidden" name="key" value={row.key} />
                <div className="min-w-0 sm:w-1/3">
                  <p className="text-xs text-muted-foreground">{labels.key}</p>
                  <p className="break-all font-mono text-xs" title={row.key}>
                    {row.key === "message" ? `${row.key} · ${labels.messageKey}` : row.key}
                  </p>
                </div>
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{labels.label}</span>
                  <Input
                    name="label"
                    defaultValue={row.label}
                    placeholder={row.autoLabel}
                    maxLength={maxLength}
                    className="px-2 py-1"
                  />
                </label>
                <label className="flex min-h-9 items-center gap-2">
                  <input
                    type="checkbox"
                    name="prominent"
                    value={row.key}
                    defaultChecked={row.prominent}
                    className="size-4"
                  />
                  {labels.prominent}
                </label>
              </li>
            ))}
          </ul>
          {state.error && (
            <p role="alert" className="text-destructive">
              {labels.errors[state.error] ?? labels.errors.unknown}
            </p>
          )}
          {state.saved && <p className="text-muted-foreground">{labels.saved}</p>}
          <div>
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {labels.save}
            </Button>
          </div>
        </form>
      )}
    </details>
  );
}
