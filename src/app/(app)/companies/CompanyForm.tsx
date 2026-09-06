"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form-fields";
import type { CompanyFormState } from "./actions";

const initialState: CompanyFormState = { error: null };

export type CompanyFormLabels = {
  name: string;
  ruc: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  submit: string;
  errors: { invalid: string; nameTaken: string };
};

export function CompanyForm({
  action,
  defaults,
  labels,
}: {
  action: (state: CompanyFormState, formData: FormData) => Promise<CompanyFormState>;
  defaults?: {
    name: string;
    ruc: string;
    phone: string;
    email: string;
    address: string;
    notes: string;
  };
  labels: CompanyFormLabels;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {labels.name}
        <Input name="name" required maxLength={200} defaultValue={defaults?.name} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {labels.ruc}
        <Input name="ruc" maxLength={30} defaultValue={defaults?.ruc} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {labels.phone}
        <Input name="phone" maxLength={20} defaultValue={defaults?.phone} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {labels.email}
        <Input name="email" type="email" maxLength={320} defaultValue={defaults?.email} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {labels.address}
        <Input name="address" maxLength={500} defaultValue={defaults?.address} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {labels.notes}
        <Textarea name="notes" defaultValue={defaults?.notes} />
      </label>
      <Button type="submit" disabled={pending} className="w-fit">
        {labels.submit}
      </Button>
      {state.error && (
        <span role="alert" className="text-xs text-destructive">
          {labels.errors[state.error as "invalid" | "nameTaken"] ?? labels.errors.invalid}
        </span>
      )}
    </form>
  );
}
