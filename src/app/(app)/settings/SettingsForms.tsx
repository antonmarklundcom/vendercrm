"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { BusinessHours } from "@/modules/tenancy/settings";
import {
  updateAiSettingsAction,
  updateBrandingAction,
  updateBusinessHoursAction,
  updateDefaultCountryAction,
  updateReviewLinkAction,
  updateTimezoneAction,
  type SettingsFormState,
} from "./actions";
import { Input, Select, Textarea } from "@/components/ui/form-fields";

// Every settings form here shares the useActionState shape (PLAN.md §10 1R
// #6): declared client-side because a "use server" module may only export
// async functions.
const initialState: SettingsFormState = { error: null, saved: false, values: {} };

// A checkbox that isn't ticked sends nothing at all, so an absent key can
// mean either "unticked" or "never submitted". Every one of these forms
// always posts at least one other field, so a non-empty `values` is the
// reliable signal that a submit has come back — only then does the echo win
// over the server-rendered prop.
function echoedCheckbox(values: Record<string, string>, name: string, fallback: boolean) {
  return Object.keys(values).length > 0 ? values[name] === "on" : fallback;
}

function ErrorOrSaved({
  state,
  tc,
  t,
}: {
  state: SettingsFormState;
  tc: ReturnType<typeof useTranslations<"common">>;
  t: ReturnType<typeof useTranslations<"app.settings">>;
}) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t(`errors.${state.error}` as "errors.unknown")}
      </p>
    );
  }
  if (state.saved) {
    return <p role="status" className="text-sm text-muted-foreground">{tc("saved")}</p>;
  }
  return null;
}

export function BrandingForm({
  logoUrl,
  primaryColor,
}: {
  logoUrl: string;
  primaryColor: string;
}) {
  const t = useTranslations("app.settings");
  const tc = useTranslations("common");
  const [state, formAction, pending] = useActionState(updateBrandingAction, initialState);

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        {t("logoUrl")}
        {/* Not type="url": the browser's own bubble in its own language
            would beat the server's Spanish message (§1.2, §10 1R #6). */}
        <Input
          name="logoUrl"
          defaultValue={state.values.logoUrl ?? logoUrl}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("primaryColor")}
        <Input
          name="primaryColor"
          type="color"
          defaultValue={state.values.primaryColor ?? primaryColor}
          className="h-10 w-20"
        />
      </label>
      <ErrorOrSaved state={state} tc={tc} t={t} />
      <Button type="submit" disabled={pending}>
        {tc("save")}
      </Button>
    </form>
  );
}

export function TimezoneForm({ timezone }: { timezone: string }) {
  const t = useTranslations("app.settings");
  const tc = useTranslations("common");
  const [state, formAction, pending] = useActionState(updateTimezoneAction, initialState);

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-2">
      <div className="flex gap-2">
        <Input
          name="timezone"
          defaultValue={state.values.timezone ?? timezone}
          className="flex-1"
        />
        <Button type="submit" variant="outline" disabled={pending}>
          {tc("save")}
        </Button>
      </div>
      <ErrorOrSaved state={state} tc={tc} t={t} />
    </form>
  );
}

export function DefaultCountryForm({
  defaultCountry,
  countryCodes,
}: {
  defaultCountry: string;
  countryCodes: readonly string[];
}) {
  const t = useTranslations("app.settings");
  const tc = useTranslations("common");
  const [state, formAction, pending] = useActionState(updateDefaultCountryAction, initialState);

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-2">
      <div className="flex gap-2">
        <Select
          name="defaultCountry"
          defaultValue={state.values.defaultCountry ?? defaultCountry}
          className="flex-1"
        >
          {countryCodes.map((code) => (
            <option key={code} value={code}>
              {t(`countryNames.${code}` as "countryNames.PY")}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline" disabled={pending}>
          {tc("save")}
        </Button>
      </div>
      <ErrorOrSaved state={state} tc={tc} t={t} />
    </form>
  );
}

export function ReviewLinkForm({ reviewLink }: { reviewLink: string }) {
  const t = useTranslations("app.settings");
  const tc = useTranslations("common");
  const [state, formAction, pending] = useActionState(updateReviewLinkAction, initialState);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-2">
      <div className="flex gap-2">
        {/* Not type="url": same reason as the logo field — the browser's
            own validation bubble would beat the server's Spanish message. */}
        <Input
          name="reviewLink"
          defaultValue={state.values.reviewLink ?? reviewLink}
          placeholder="https://g.page/r/.../review"
          className="flex-1"
        />
        <Button type="submit" variant="outline" disabled={pending}>
          {tc("save")}
        </Button>
      </div>
      <ErrorOrSaved state={state} tc={tc} t={t} />
    </form>
  );
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function BusinessHoursForm({ businessHours }: { businessHours: BusinessHours }) {
  const t = useTranslations("app.settings");
  const tc = useTranslations("common");
  const [state, formAction, pending] = useActionState(updateBusinessHoursAction, initialState);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      {DAYS.map((day) => (
        // Wraps instead of clipping on a phone: the day label plus two time
        // inputs is wider than 390px, and a time input can't be shrunk
        // usefully (PLAN.md §13 H7).
        <div key={day} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <label className="flex w-32 shrink-0 items-center gap-2">
            <input
              type="checkbox"
              name={`${day}_enabled`}
              defaultChecked={echoedCheckbox(
                state.values,
                `${day}_enabled`,
                !!businessHours[day],
              )}
            />
            {t(`days.${day}` as "days.mon")}
          </label>
          <Input
            type="time"
            name={`${day}_start`}
            defaultValue={state.values[`${day}_start`] ?? businessHours[day]?.start ?? "08:00"}
            className="min-w-0 px-2 py-1"
          />
          <span>—</span>
          <Input
            type="time"
            name={`${day}_end`}
            defaultValue={state.values[`${day}_end`] ?? businessHours[day]?.end ?? "18:00"}
            className="min-w-0 px-2 py-1"
          />
        </div>
      ))}
      <ErrorOrSaved state={state} tc={tc} t={t} />
      <Button type="submit" className="mt-2 w-fit" disabled={pending}>
        {tc("save")}
      </Button>
    </form>
  );
}

export function AiSettingsForm({
  enabled,
  mode,
  businessName,
  businessNamePlaceholder,
  neverPromise,
  maxRepliesPerConversationPerDay,
  maxRepliesPerTenantPerDay,
  handoffKeyword,
  bookingEnabled,
}: {
  enabled: boolean;
  mode: string;
  businessName: string;
  businessNamePlaceholder: string;
  neverPromise: string;
  maxRepliesPerConversationPerDay: number;
  maxRepliesPerTenantPerDay: number;
  handoffKeyword: string;
  bookingEnabled: boolean;
}) {
  const t = useTranslations("app.settings");
  const tc = useTranslations("common");
  const [state, formAction, pending] = useActionState(updateAiSettingsAction, initialState);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={echoedCheckbox(state.values, "enabled", enabled)}
        />
        {t("aiEnabled")}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("aiMode")}
        <Select
          name="mode"
          defaultValue={state.values.mode ?? mode}
          className="max-w-xs"
        >
          <option value="draft">{t("aiModeDraft")}</option>
          <option value="send">{t("aiModeSend")}</option>
        </Select>
        <span className="text-xs text-muted-foreground">{t("aiModeHelp")}</span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("aiBusinessName")}
        <Input
          name="businessName"
          defaultValue={state.values.businessName ?? businessName}
          placeholder={businessNamePlaceholder}
        />
      </label>

      {/* "Sobre el negocio", "Tono" and "Horario" used to live here as free
          text; they are now inert (resolveAiConfig never reads them — the
          memory profile at /settings/negocio is the one source for all
          three, PLAN.md §16.4). Link there instead of duplicating a form
          the reply engine has already stopped listening to (K1's open item,
          closed by the wave 2 link pass, P18). */}
      <p className="text-sm text-muted-foreground">
        {t("aiBusinessProfileIntro")}{" "}
        <Link href="/settings/negocio" className="underline">
          {t("aiBusinessProfileLink")}
        </Link>
      </p>

      <label className="flex flex-col gap-1 text-sm">
        {t("aiNeverPromise")}
        <Textarea
          name="neverPromise"
          rows={2}
          defaultValue={state.values.neverPromise ?? neverPromise}
          placeholder={t("aiNeverPromisePlaceholder")}
        />
      </label>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm">
          {t("aiMaxPerConversation")}
          {/* inputMode, not type="number": server validates the ceiling
              (§10 1R #6), a browser bubble in the wrong language shouldn't
              beat it there. */}
          <Input
            inputMode="numeric"
            name="maxRepliesPerConversationPerDay"
            defaultValue={
              state.values.maxRepliesPerConversationPerDay ?? String(maxRepliesPerConversationPerDay)
            }
            className="w-28"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("aiMaxPerTenant")}
          <Input
            inputMode="numeric"
            name="maxRepliesPerTenantPerDay"
            defaultValue={state.values.maxRepliesPerTenantPerDay ?? String(maxRepliesPerTenantPerDay)}
            className="w-28"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("aiHandoffKeyword")}
          <Input
            name="handoffKeyword"
            defaultValue={state.values.handoffKeyword ?? handoffKeyword}
            className="w-40"
          />
        </label>
      </div>

      {/* Off by default and gated per tenant, on the same principle as
          `mode`: a capability that reaches customers starts switched off.
          The assistant can only *offer* times — the customer's tap is what
          reserves, through the ordinary transactional path. */}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="bookingEnabled"
          defaultChecked={echoedCheckbox(state.values, "bookingEnabled", bookingEnabled)}
        />
        {t("aiBookingEnabled")}
      </label>
      <p className="text-xs text-muted-foreground">{t("aiBookingEnabledHelp")}</p>

      <ErrorOrSaved state={state} tc={tc} t={t} />

      <Button type="submit" className="w-fit" disabled={pending}>
        {tc("save")}
      </Button>
    </form>
  );
}
