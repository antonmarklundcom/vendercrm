"use client";

import { useActionState, useState } from "react";
import { useCloseCreateDialogOnSuccess } from "@/components/create-dialog";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form-fields";
import { ContactPicker, type PickedContact } from "./ContactPicker";
import type { CalendarField, CalendarFormState } from "./actions";

// Lives here, not in actions.ts: a "use server" module may only export async
// functions, so a shared constant there fails the build (same reason
// ContactCreateForm keeps its own).
const EMPTY_CALENDAR_FORM: CalendarFormState = {
  error: null,
  field: null,
  saved: false,
  values: {},
};

// One form for booking and for editing — the fields are identical, and the
// only difference is which action it is handed and what it starts filled
// with. Times are the tenant's wall clock in both directions: the server
// converts (actions.ts), so nothing here has to know what UTC is.

export type EventFormDefaults = {
  title?: string;
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  contactId?: string;
  assignedUserId?: string;
};

export function EventForm({
  action,
  defaults,
  contact,
  users,
  submitLabel,
}: {
  action: (state: CalendarFormState, formData: FormData) => Promise<CalendarFormState>;
  defaults: EventFormDefaults;
  /** The contact this event is already about, when editing one. */
  contact?: PickedContact | null;
  users: { id: string; name: string }[];
  submitLabel: string;
}) {
  const t = useTranslations("app.calendar");
  const [state, formAction, pending] = useActionState(action, EMPTY_CALENDAR_FORM);
  // Inside the agenda's CreateDialog: close once the event is saved. A no-op
  // where this form is rendered inline (editing an existing event).
  useCloseCreateDialogOnSuccess(state, (s) => s.saved);
  // Controlled so the time boxes can disappear for an all-day event — an
  // empty pair of times next to "todo el día" is a question with no answer.
  const [allDay, setAllDay] = useState(defaults.allDay ?? false);

  const value = (name: keyof EventFormDefaults) =>
    state.values[name] ?? (defaults[name] as string | undefined) ?? "";

  function FieldError({ field }: { field: CalendarField }) {
    if (state.field !== field || !state.error) return null;
    return (
      <span role="alert" className="text-xs text-destructive">
        {t(`errors.${state.error}` as "errors.unknown")}
      </span>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        {t("form.title")}
        <Input name="title" defaultValue={value("title")} />
        <FieldError field="title" />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="allDay"
          checked={allDay}
          onChange={(event) => setAllDay(event.target.checked)}
        />
        {t("form.allDay")}
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t("form.startDate")}
          <Input type="date" name="startDate" defaultValue={value("startDate")} />
          <FieldError field="startDate" />
        </label>
        {!allDay && (
          <label className="flex flex-col gap-1 text-sm">
            {t("form.startTime")}
            <Input type="time" name="startTime" defaultValue={value("startTime") || "09:00"} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          {t("form.endDate")}
          <Input type="date" name="endDate" defaultValue={value("endDate")} />
          <FieldError field="endDate" />
        </label>
        {!allDay && (
          <label className="flex flex-col gap-1 text-sm">
            {t("form.endTime")}
            <Input type="time" name="endTime" defaultValue={value("endTime")} />
          </label>
        )}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        {t("form.location")}
        <Input name="location" defaultValue={value("location")} />
      </label>

      <div className="flex flex-wrap gap-3">
        <span className="flex flex-col gap-1 text-sm">
          {t("form.contact")}
          <ContactPicker name="contactId" initial={contact} />
        </span>
        <label className="flex flex-col gap-1 text-sm">
          {t("form.assignee")}
          <Select name="assignedUserId" defaultValue={value("assignedUserId")}>
            <option value="">{t("form.noAssignee")}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        {t("form.description")}
        <Textarea name="description" rows={3} defaultValue={value("description")} />
      </label>

      {state.error && state.field === null && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${state.error}` as "errors.unknown")}
        </p>
      )}
      {state.saved && <p className="text-sm text-muted-foreground">{t("form.saved")}</p>}

      <Button type="submit" disabled={pending} className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
