"use client";

import { useActionState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-fields";
import { CreateDialog, useCloseCreateDialogOnSuccess } from "@/components/create-dialog";
import { updateTenantAction, type UpdateTenantState } from "./actions";

const initialState: UpdateTenantState = { error: null, field: null, values: {}, success: false };

export type EditTenantLabels = {
  trigger: string;
  title: string;
  close: string;
  name: string;
  slug: string;
  locale: string;
  timezone: string;
  save: string;
  errors: {
    nameRequired: string;
    slugInvalid: string;
    slugTaken: string;
    unknown: string;
  };
};

export function EditTenantDialog({
  tenant,
  locales,
  labels,
}: {
  tenant: { id: string; name: string; slug: string; locale: string; timezone: string };
  locales: Array<{ value: string; label: string }>;
  labels: EditTenantLabels;
}) {
  return (
    <CreateDialog
      id="editar-empresa"
      triggerLabel={labels.trigger}
      title={labels.title}
      closeLabel={labels.close}
      variant="outline"
      icon={<Pencil className="size-4" aria-hidden="true" />}
    >
      <EditTenantForm tenant={tenant} locales={locales} labels={labels} />
    </CreateDialog>
  );
}

function EditTenantForm({
  tenant,
  locales,
  labels,
}: {
  tenant: { id: string; name: string; slug: string; locale: string; timezone: string };
  locales: Array<{ value: string; label: string }>;
  labels: EditTenantLabels;
}) {
  const [state, formAction, pending] = useActionState(updateTenantAction, initialState);
  useCloseCreateDialogOnSuccess(state, (s) => s.success);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantId" value={tenant.id} />
      <label className="flex flex-col gap-1 text-sm">
        {labels.name}
        <Input name="name" defaultValue={state.values.name ?? tenant.name} required />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {labels.slug}
        <Input
          name="slug"
          defaultValue={state.values.slug ?? tenant.slug}
          pattern="[a-z0-9-]+"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {labels.locale}
        <Select name="locale" defaultValue={state.values.locale ?? tenant.locale}>
          {locales.map((locale) => (
            <option key={locale.value} value={locale.value}>
              {locale.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {labels.timezone}
        <Input name="timezone" defaultValue={state.values.timezone ?? tenant.timezone} required />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {labels.errors[state.error as keyof typeof labels.errors] ?? labels.errors.unknown}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {labels.save}
      </Button>
    </form>
  );
}
