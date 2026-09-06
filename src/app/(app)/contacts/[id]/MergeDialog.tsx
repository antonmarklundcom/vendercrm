"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form-fields";
import { mergeContactAction, type MergeFormState } from "../merge-actions";
import type { ContactFieldKey } from "@/modules/crm/merge";

const initialState: MergeFormState = { error: null };

export type MergeDialogLabels = {
  otherContact: string;
  chooseContact: string;
  fields: Record<ContactFieldKey, string>;
  keepWinner: string;
  keepOther: string;
  countsWillMove: string;
  confirm: string;
  warning: string;
  errors: Record<string, string>;
};

const FIELD_KEYS: ContactFieldKey[] = [
  "name",
  "email",
  "notes",
  "source",
  "ownerUserId",
  "companyId",
];

/**
 * The merge dialog on a contact's own "fusionar" tab (PLAN.md §17.3 P16) —
 * this contact is always the winner, keeping its id, phone and history. No
 * undo, so the confirm button names exactly what will move.
 */
export function MergeDialog({
  contactId,
  contactLabel,
  candidates,
  defaultOtherId,
  labels,
}: {
  contactId: string;
  contactLabel: string;
  candidates: Array<{ id: string; label: string }>;
  defaultOtherId?: string;
  labels: MergeDialogLabels;
}) {
  const [otherId, setOtherId] = useState(defaultOtherId ?? "");
  const [state, formAction, pending] = useActionState(mergeContactAction, initialState);

  const other = candidates.find((c) => c.id === otherId);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      <input type="hidden" name="winnerId" value={contactId} />

      <label className="flex flex-col gap-1 text-sm">
        {labels.otherContact}
        <Select
          name="loserId"
          required
          value={otherId}
          onChange={(event) => setOtherId(event.target.value)}
        >
          <option value="" disabled>
            {labels.chooseContact}
          </option>
          {candidates
            .filter((c) => c.id !== contactId)
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
        </Select>
      </label>

      {other && (
        <>
          <p className="text-xs text-muted-foreground">{labels.countsWillMove}</p>
          <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
            {FIELD_KEYS.map((key) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{labels.fields[key]}</span>
                <div className="flex gap-3">
                  <label className="flex items-center gap-1">
                    <input type="radio" name={`field_${key}`} value="winner" defaultChecked />
                    {contactLabel}
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name={`field_${key}`} value="loser" />
                    {other.label}
                  </label>
                </div>
              </div>
            ))}
          </div>

          <p className="rounded-md border border-warning/30 bg-warning-surface px-3 py-2 text-sm text-warning">
            {labels.warning}
          </p>

          <Button type="submit" disabled={pending} className="w-fit">
            {labels.confirm}
          </Button>
        </>
      )}

      {state.error && (
        <span role="alert" className="text-sm text-destructive">
          {labels.errors[state.error] ?? labels.errors.invalid}
        </span>
      )}
    </form>
  );
}
