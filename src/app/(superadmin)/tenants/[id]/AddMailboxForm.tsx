"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-fields";
import { addTenantMailboxAction, type AddMailboxState } from "./mailbox-actions";

export type AddMailboxLabels = {
  address: string;
  addressPlaceholder: string;
  displayName: string;
  catchAll: string;
  catchAllHelp: string;
  submit: string;
  added: string;
  errors: Record<string, string>;
};

const initial: AddMailboxState = { error: null, added: null };

export function AddMailboxForm({ tenantId, labels }: { tenantId: string; labels: AddMailboxLabels }) {
  const [state, formAction, pending] = useActionState(addTenantMailboxAction, initial);

  return (
    <form action={formAction} className="flex max-w-xl flex-wrap items-end gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
        {labels.address}
        <Input name="address" type="email" required placeholder={labels.addressPlaceholder} />
      </label>
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
        {labels.displayName}
        <Input name="displayName" maxLength={200} />
      </label>
      <label className="flex items-center gap-2 text-sm" title={labels.catchAllHelp}>
        <input type="checkbox" name="isCatchAll" className="size-4" />
        {labels.catchAll}
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {labels.submit}
      </Button>
      {state.error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {labels.errors[state.error] ?? labels.errors.unknown}
        </p>
      )}
      {state.added && (
        <p className="w-full text-xs text-muted-foreground">
          {labels.added} <strong>{state.added}</strong>
        </p>
      )}
    </form>
  );
}
