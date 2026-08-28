"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createDealAction, type DealField, type DealFormState } from "./actions";
import { Input, Select } from "@/components/ui/form-fields";
import { useFormDialogClose } from "@/components/ui/form-dialog";

// Declared here rather than in actions.ts: a "use server" module may only
// export async functions.
const initialState: DealFormState = {
  error: null,
  field: null,
  created: false,
  values: {},
};

// Create-deal form (PLAN.md §10 1R #6), useActionState-shaped like the 1M
// auth forms. The value box is the one that actually bites: guaraníes are
// integer minor units (§2.3), so "1.5" used to reach zod and throw an error
// page — now it comes back under the field.

type Option = { id: string; name: string };

export function CreateDealForm({
  pipelineId,
  contacts,
  stages,
}: {
  pipelineId: string;
  contacts: Option[];
  stages: Option[];
}) {
  const t = useTranslations("app.pipeline");
  const [state, formAction, pending] = useActionState(
    createDealAction,
    initialState,
  );

  const closeDialog = useFormDialogClose();
  const notified = useRef(false);
  useEffect(() => {
    if (!state.created || notified.current) return;
    notified.current = true;
    toast.success(t("createdToast"));
    closeDialog();
  }, [state.created, closeDialog, t]);

  function FieldError({ field }: { field: DealField }) {
    if (state.field !== field || !state.error) return null;
    return (
      <span role="alert" className="text-xs text-destructive">
        {t(`errors.${state.error}` as "errors.unknown")}
      </span>
    );
  }

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-4">
      <input type="hidden" name="pipelineId" value={pipelineId} />
      <label className="flex flex-col gap-1 text-sm">
        {t("dealTitle")}
        <Input
          name="title"
          defaultValue={state.values.title ?? ""}
        />
        <FieldError field="title" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("contact")}
        <Select
          name="contactId"
          defaultValue={state.values.contactId}
        >
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </Select>
        <FieldError field="contactId" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("stage")}
        <Select
          name="stageId"
          defaultValue={state.values.stageId}
        >
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </Select>
        <FieldError field="stageId" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("value")}
        {/* Not type="number": it defaults to step="1", so the browser
            silently blocks the submit on "1.5" with its own bubble, in its
            own language, and the Spanish message below never runs (§1.2).
            inputMode gets the numeric keypad without the validation. */}
        <Input
          name="value"
          inputMode="numeric"
          defaultValue={state.values.value ?? ""}
        />
        <FieldError field="value" />
      </label>
      {state.error && state.field === null && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${state.error}` as "errors.unknown")}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {t("createDeal")}
      </Button>
    </form>
  );
}
