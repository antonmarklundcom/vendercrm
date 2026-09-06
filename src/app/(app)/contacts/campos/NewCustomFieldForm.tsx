"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-fields";
import { createCustomFieldAction, type CustomFieldFormState } from "../actions";

const initialState: CustomFieldFormState = { error: null };

export function NewCustomFieldForm({
  typeOptions,
}: {
  typeOptions: Array<{ value: string; label: string }>;
}) {
  const t = useTranslations("app.customFields");
  const [state, formAction, pending] = useActionState(createCustomFieldAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState(typeOptions[0]?.value ?? "text");

  useEffect(() => {
    if (state === initialState) return;
    if (!state.error) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex max-w-md flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        {t("labelLabel")}
        <Input name="label" required maxLength={200} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("typeLabel")}
        <Select name="type" value={type} onChange={(e) => setType(e.target.value)}>
          {typeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
      {type === "select" && (
        <label className="flex flex-col gap-1 text-sm">
          {t("optionsLabel")}
          <Input name="options" placeholder="A, B, C" />
        </label>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="required" className="h-4 w-4" />
        {t("requiredLabel")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="showOnCard" className="h-4 w-4" />
        {t("showOnCardLabel")}
      </label>
      <Button type="submit" size="sm" className="w-fit" disabled={pending}>
        {t("create")}
      </Button>
      {state.error && (
        <span role="alert" className="text-xs text-destructive">
          {state.error === "keyTaken" ? t("keyTaken") : t("create")}
        </span>
      )}
    </form>
  );
}
