"use client";

import { useActionState } from "react";
import { decideContractAction, type ContractDecisionState } from "./actions";

const initialState: ContractDecisionState = { error: null, done: null };

export type ContractDecisionLabels = {
  prompt: string;
  nameLabel: string;
  namePlaceholder: string;
  accept: string;
  decline: string;
  acceptedGeneric: string;
  declinedGeneric: string;
  errors: Record<string, string>;
};

/** "Aceptar" / "Rechazar" on the public contract page (PLAN.md §17.3 P13) —
 *  a typed name is the click-to-accept evidence (§17.1 #5). */
export function ContractDecisionForm({
  token,
  labels,
}: {
  token: string;
  labels: ContractDecisionLabels;
}) {
  const action = decideContractAction.bind(null, token);
  const [state, formAction, pending] = useActionState(action, initialState);

  if (state.done) {
    return (
      <p className="rounded-md border bg-muted px-3 py-2 text-sm">
        {state.done === "accepted" ? labels.acceptedGeneric : labels.declinedGeneric}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border p-4">
      <p className="text-sm font-medium">{labels.prompt}</p>
      <label className="flex flex-col gap-1 text-sm">
        {labels.nameLabel}
        <input
          name="name"
          required
          maxLength={200}
          placeholder={labels.namePlaceholder}
          className="rounded-md border bg-card px-3 py-2 text-sm"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          name="decision"
          value="accepted"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
        >
          {labels.accept}
        </button>
        <button
          type="submit"
          name="decision"
          value="declined"
          disabled={pending}
          className="rounded-md border px-4 py-2 text-sm disabled:opacity-60"
        >
          {labels.decline}
        </button>
      </div>
      {state.error && (
        <span role="alert" className="text-xs text-destructive">
          {labels.errors[state.error] ?? labels.errors.invalid}
        </span>
      )}
    </form>
  );
}
