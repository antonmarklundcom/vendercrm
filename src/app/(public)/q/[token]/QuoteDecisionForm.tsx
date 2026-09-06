"use client";

import { useActionState } from "react";
import { decideQuoteAction, type DecisionState } from "./actions";

const initialState: DecisionState = { error: null, done: null };

export type DecisionLabels = {
  prompt: string;
  nameLabel: string;
  namePlaceholder: string;
  commentLabel: string;
  commentPlaceholder: string;
  accept: string;
  reject: string;
  /** Shown for the brief moment between the action resolving and the page's
   *  own re-fetch (which then shows the persisted decision, with the name,
   *  instead of this form at all) — so neither needs a `{name}` value. */
  acceptedGeneric: string;
  rejectedGeneric: string;
  errors: Record<string, string>;
};

/** "Aceptar" / "Rechazar" on the public quote page (PLAN.md §8, §15.8 P6) —
 *  a typed name and optional comment, one shared form for both buttons. */
export function QuoteDecisionForm({ token, labels }: { token: string; labels: DecisionLabels }) {
  const action = decideQuoteAction.bind(null, token);
  const [state, formAction, pending] = useActionState(action, initialState);

  if (state.done) {
    return (
      <p className="rounded-md border bg-muted px-3 py-2 text-sm">
        {state.done === "accepted" ? labels.acceptedGeneric : labels.rejectedGeneric}
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
      <label className="flex flex-col gap-1 text-sm">
        {labels.commentLabel}
        <textarea
          name="comment"
          maxLength={1000}
          placeholder={labels.commentPlaceholder}
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
          value="rejected"
          disabled={pending}
          className="rounded-md border px-4 py-2 text-sm disabled:opacity-60"
        >
          {labels.reject}
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
