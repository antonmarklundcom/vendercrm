"use client";

import { useState } from "react";
import Script from "next/script";
import { TURNSTILE_RESPONSE_FIELD } from "@/lib/turnstile";
import type { BookingQuestion } from "@/modules/booking/types";
import { SlotPicker } from "../../slot-picker";

// The visitor's half of the booking page (docs/SPEC-BOOKING.md §5).
//
// Client-side only because picking a day should not reload the page — every
// fetch below is **same-origin**, to our own /api/v1/booking routes, which is
// what lets this exist without adding a CORS surface (§5.1's lock).

type Labels = {
  chooseDay: string;
  chooseTime: string;
  noSlots: string;
  previousMonth: string;
  nextMonth: string;
  yourData: string;
  name: string;
  phone: string;
  email: string;
  message: string;
  submit: string;
  confirmedTitle: string;
  manageHint: string;
  errorSlotTaken: string;
  errorGeneric: string;
  rateLimited: string;
  servicesTitle: string;
  partySize: string;
  seatsRemaining: string;
  depositTitle: string;
  depositBody: string;
  errorPartyTooLarge: string;
};

type Service = {
  id: string;
  name: string;
  extraDurationMinutes: number;
  extraPrice: number | null;
};

type Props = {
  tenantSlug: string;
  typeSlug: string;
  timeZone: string;
  locale: string;
  questions: BookingQuestion[];
  turnstileSiteKey: string | null;
  accent?: string;
  labels: Labels;
  services: Service[];
  /** > 1 turns on the party-size field and the "quedan N lugares" hints. */
  capacity: number;
  /** Formatted seña, e.g. "₲ 50.000". Null when the type asks for none. */
  depositAmount: string | null;
};

export function BookingPicker({
  tenantSlug,
  typeSlug,
  timeZone,
  locale,
  questions,
  turnstileSiteKey,
  accent,
  labels,
  services,
  capacity,
  depositAmount,
}: Props) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [partySize, setPartySize] = useState(1);
  // Slots this visitor has learned are gone: the 409 case, where somebody
  // else took the time while the form was open.
  const [taken, setTaken] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<{
    startsAt: string;
    manageUrl: string;
    pendingDeposit: boolean;
  } | null>(null);

  if (confirmed) {
    return (
      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="text-lg font-semibold" style={{ color: accent }}>
          {/* A held slot is not a confirmed appointment, and telling someone
              "¡listo!" before they have transferred the seña is how a chair
              ends up empty on a Saturday. */}
          {confirmed.pendingDeposit ? labels.depositTitle : labels.confirmedTitle}
        </h2>
        <p className="text-sm">
          {new Intl.DateTimeFormat(locale, {
            timeZone,
            dateStyle: "full",
            timeStyle: "short",
          }).format(new Date(confirmed.startsAt))}
        </p>
        {confirmed.pendingDeposit ? (
          <p className="text-sm">{labels.depositBody}</p>
        ) : null}
        <p className="text-sm text-muted-foreground">{labels.manageHint}</p>
        <a className="text-sm underline" href={confirmed.manageUrl}>
          {confirmed.manageUrl}
        </a>
      </section>
    );
  }

  async function submit(formData: FormData) {
    if (!chosen) return;
    setSubmitting(true);
    setError(null);

    const answers: Record<string, string> = {};
    for (const question of questions) {
      const value = formData.get(`q_${question.key}`);
      if (value) answers[question.key] = String(value);
    }

    try {
      const response = await fetch(
        `/api/v1/booking/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(typeSlug)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            startsAt: chosen,
            name: formData.get("name"),
            phone: formData.get("phone"),
            email: formData.get("email") || undefined,
            message: formData.get("message") || undefined,
            answers,
            party_size: capacity > 1 ? partySize : undefined,
            service_ids: serviceIds.length > 0 ? serviceIds : undefined,
            _hp: formData.get("_hp") || undefined,
            turnstile_token: formData.get(TURNSTILE_RESPONSE_FIELD) || undefined,
            page_url: globalThis.location?.href,
            referrer: document.referrer || undefined,
          }),
        },
      );

      if (response.status === 409) {
        // Someone took it while the form was open. Drop that start from the
        // picker so the visitor chooses from what is actually free rather
        // than retrying a dead slot.
        setError(labels.errorSlotTaken);
        setTaken((current) => [...current, chosen]);
        setChosen(null);
        return;
      }
      if (!response.ok) {
        const reason = await response
          .json()
          .then((payload: { error?: string }) => payload.error)
          .catch(() => undefined);
        setError(
          reason === "party_too_large"
            ? labels.errorPartyTooLarge
            : response.status === 429
              ? labels.rateLimited
              : labels.errorGeneric,
        );
        return;
      }

      const body = (await response.json()) as {
        startsAt: string;
        manageToken: string;
        status: string;
      };
      setConfirmed({
        startsAt: body.startsAt,
        manageUrl: `${globalThis.location.origin}/b/g/${body.manageToken}`,
        pendingDeposit: body.status === "pending_deposit",
      });
    } catch {
      setError(labels.errorGeneric);
    } finally {
      setSubmitting(false);
    }
  }

  const durationSuffix = (service: Service) =>
    service.extraDurationMinutes > 0 ? ` +${service.extraDurationMinutes} min` : "";

  return (
    <div className="flex flex-col gap-6">
      {/* Add-ons and party size come *before* the calendar on purpose: both
          change which slots can be offered, so asking after the visitor has
          picked a time would mean taking that time back. */}
      {services.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-lg border p-4">
          <h2 className="text-sm font-medium">{labels.servicesTitle}</h2>
          {services.map((service) => (
            <label key={service.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={serviceIds.includes(service.id)}
                onChange={(event) => {
                  // Changing the length of the appointment invalidates the
                  // chosen time, so it is dropped rather than silently
                  // re-submitted against a slot that no longer fits.
                  setChosen(null);
                  setServiceIds((current) =>
                    event.target.checked
                      ? [...current, service.id]
                      : current.filter((id) => id !== service.id),
                  );
                }}
              />
              <span>
                {service.name}
                {durationSuffix(service)}
              </span>
            </label>
          ))}
        </section>
      ) : null}

      {capacity > 1 ? (
        <label className="flex flex-col gap-1 text-sm">
          {labels.partySize}
          <input
            type="number"
            min={1}
            max={capacity}
            value={partySize}
            onChange={(event) => {
              setChosen(null);
              setPartySize(Math.max(1, Math.min(capacity, Number(event.target.value) || 1)));
            }}
            className="w-24 rounded-md border px-3 py-2"
          />
        </label>
      ) : null}

      <SlotPicker
        tenantSlug={tenantSlug}
        typeSlug={typeSlug}
        timeZone={timeZone}
        locale={locale}
        labels={labels}
        selected={chosen}
        onSelect={setChosen}
        excluded={taken}
        serviceIds={serviceIds}
        partySize={partySize}
        seatsLabel={
          capacity > 1
            ? (remaining) => labels.seatsRemaining.replace("{count}", String(remaining))
            : undefined
        }
      />

      {chosen ? (
        <form action={submit} className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-sm font-medium">{labels.yourData}</h2>
          {depositAmount ? (
            // Said before the visitor fills anything in: a seña discovered
            // only on the confirmation screen reads like a bait and switch.
            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              {labels.depositBody.replace("{amount}", depositAmount)}
            </p>
          ) : null}
          {/* Honeypot: real visitors never see or fill this field. */}
          <input
            type="text"
            name="_hp"
            tabIndex={-1}
            autoComplete="off"
            className="absolute -left-[9999px]"
            aria-hidden="true"
          />
          <label className="flex flex-col gap-1 text-sm">
            {labels.name}
            <input name="name" className="rounded-md border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {labels.phone}
            <input name="phone" type="tel" className="rounded-md border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {labels.email}
            <input name="email" type="email" className="rounded-md border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {labels.message}
            <textarea name="message" rows={3} className="rounded-md border px-3 py-2" />
          </label>

          {questions.map((question) => (
            <label key={question.key} className="flex flex-col gap-1 text-sm">
              {question.label}
              {question.type === "textarea" ? (
                <textarea name={`q_${question.key}`} rows={3} className="rounded-md border px-3 py-2" />
              ) : question.type === "select" ? (
                <select name={`q_${question.key}`} className="rounded-md border px-3 py-2">
                  {(question.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={`q_${question.key}`}
                  type={question.type === "email" ? "email" : "text"}
                  className="rounded-md border px-3 py-2"
                />
              )}
            </label>
          ))}

          {turnstileSiteKey ? (
            <>
              <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />
              <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js"
                async
                defer
                strategy="afterInteractive"
              />
            </>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
            style={accent ? { backgroundColor: accent } : undefined}
          >
            {labels.submit}
          </button>
        </form>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
