"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form-fields";
import { createQuickReplyAction, type QuickReplyFormState } from "../actions";

const initialState: QuickReplyFormState = { error: null };

/** Create form — a client component only for the reset-on-success behavior;
 *  edit/delete on existing rows are plain bound server actions (§15.8 P3),
 *  the same pattern the chat page's toggle buttons already use. */
export function NewQuickReplyForm() {
  const t = useTranslations("app.inbox");
  const [state, formAction, pending] = useActionState(createQuickReplyAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state === initialState) return;
    if (!state.error) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex max-w-md flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        {t("quickReplyName")}
        <Input name="name" required maxLength={100} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("quickReplyBody")}
        <Textarea name="body" required maxLength={4096} placeholder={t("quickReplyBodyHint")} />
      </label>
      <Button type="submit" size="sm" className="w-fit" disabled={pending}>
        {t("quickReplyCreate")}
      </Button>
      {state.error && (
        <span role="alert" className="text-xs text-destructive">
          {t("quickReplyInvalid")}
        </span>
      )}
    </form>
  );
}
