"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form-fields";
import { createContactAction, replyAction, type EmailFormState } from "./actions";

const initial: EmailFormState = { error: null, done: false };

export type ReplyLabels = {
  to: string;
  cc: string;
  ccHelp: string;
  body: string;
  send: string;
  sent: string;
  errors: Record<string, string>;
};

export function ReplyForm({
  threadId,
  to,
  labels,
}: {
  threadId: string;
  to: string;
  labels: ReplyLabels;
}) {
  const [state, formAction, pending] = useActionState(replyAction, initial);

  // React resets the form after each action; on an error `values` brings the
  // typed text back as the new defaults, on success the box stays empty.
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border p-4">
      <input type="hidden" name="threadId" value={threadId} />
      <p className="text-sm text-muted-foreground">
        {labels.to} <strong className="font-mono text-foreground">{to}</strong>
      </p>
      <label className="flex flex-col gap-1 text-sm">
        {labels.cc}
        <Input
          name="cc"
          placeholder={labels.ccHelp}
          autoComplete="off"
          defaultValue={state.values?.cc ?? ""}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {labels.body}
        <Textarea
          name="body"
          rows={6}
          required
          maxLength={20000}
          defaultValue={state.values?.body ?? ""}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {labels.send}
        </Button>
        {state.done && <span className="text-sm text-success">{labels.sent}</span>}
        {state.error && (
          <span role="alert" className="text-sm text-destructive">
            {labels.errors[state.error] ?? labels.errors.unknown}
          </span>
        )}
      </div>
    </form>
  );
}

export type ContactLabels = {
  title: string;
  name: string;
  phone: string;
  submit: string;
  errors: Record<string, string>;
};

export function CreateContactForm({
  threadId,
  defaultName,
  labels,
}: {
  threadId: string;
  defaultName: string;
  labels: ContactLabels;
}) {
  const [state, formAction, pending] = useActionState(createContactAction, initial);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="threadId" value={threadId} />
      <label className="flex flex-col gap-1 text-xs">
        {labels.name}
        <Input
          name="name"
          defaultValue={state.values?.name ?? defaultName}
          maxLength={200}
          className="h-8"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {labels.phone}
        <Input
          name="phone"
          type="tel"
          required
          maxLength={30}
          className="h-8"
          defaultValue={state.values?.phone ?? ""}
        />
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {labels.submit}
      </Button>
      {state.error && (
        <span role="alert" className="w-full text-xs text-destructive">
          {labels.errors[state.error] ?? labels.errors.unknown}
        </span>
      )}
    </form>
  );
}
