"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form-fields";
import { mergeUsersAction, type MergeUsersState } from "./actions";

// "Mover accesos": folds a duplicate account into another one. Behind a
// confirmation dialog because it is one-way from the operator's side — the
// source account is banned platform-wide as part of the same submit, not a
// separate step (DangerZone.tsx is the other place a superadmin action needs
// this much friction, for the same reason: the write cannot be undone from
// the UI).

const initialState: MergeUsersState = { error: null, ok: false };

export type MergeUserLabels = {
  trigger: string;
  title: string;
  body: string;
  targetEmail: string;
  submit: string;
  cancel: string;
  close: string;
  success: string;
  errors: Record<string, string>;
};

export function MergeUserDialog({
  sourceUserId,
  sourceEmail,
  labels,
}: {
  sourceUserId: string;
  sourceEmail: string;
  labels: MergeUserLabels;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(mergeUsersAction, initialState);

  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {labels.trigger}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} label={labels.title} className="max-w-md">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <h2 className="text-base font-semibold">{labels.title}</h2>
        </div>
        <div className="flex flex-col gap-4 px-5 py-4">
          {state.ok ? (
            <>
              <p className="text-sm text-success">{labels.success}</p>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {labels.close}
              </Button>
            </>
          ) : (
            <form action={formAction} className="flex flex-col gap-4">
              <input type="hidden" name="sourceUserId" value={sourceUserId} />
              <p className="text-sm text-muted-foreground">
                {labels.body} <strong>{sourceEmail}</strong>
              </p>
              <label className="flex flex-col gap-1 text-sm">
                {labels.targetEmail}
                <Input name="targetEmail" type="email" required />
              </label>
              {state.error && (
                <p role="alert" className="text-sm text-destructive">
                  {labels.errors[state.error] ?? state.error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {labels.cancel}
                </Button>
                <Button type="submit" variant="destructive" disabled={pending}>
                  {labels.submit}
                </Button>
              </div>
            </form>
          )}
        </div>
      </Dialog>
    </>
  );
}
