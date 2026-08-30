import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getPublicBooking } from "@/modules/booking/public";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { clientIp } from "@/lib/http/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTranslator } from "@/lib/i18n/translator";
import { formatDateTime } from "@/lib/i18n/format";
import { cancelBookingAction } from "./actions";
import { RescheduleSection } from "./reschedule";

// The visitor's manage link (docs/SPEC-BOOKING.md §5). The token *is* the
// secret — the same model as the public quote view /q/[token] — which is why
// an unknown one is a flat 404 and never a hint about which half was wrong.

export default async function ManageBookingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const ip = clientIp(await headers());
  if (checkRateLimit(`booking-manage-page:${ip}`, 60, 60_000).limited) {
    const tLimit = await getTranslator(null, "public.shared");
    return (
      <main className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">
        {tLimit("rateLimited")}
      </main>
    );
  }

  const resolved = await getPublicBooking(token);
  if (!resolved) notFound();

  const { booking, type, tenant, canCancel } = resolved;
  const branding = ((tenant.settings ?? {}) as TenantSettings).branding ?? {};
  const accent = branding.primaryColor || undefined;
  const locale = tenant.locale ?? "es";
  const t = await getTranslator(locale, "public.booking");
  const tShared = await getTranslator(locale, "public.shared");

  const statusLabel = {
    confirmed: t("statusConfirmed"),
    pending_deposit: t("statusPendingDeposit"),
    cancelled: t("statusCancelled"),
    completed: t("statusCompleted"),
    no_show: t("statusNoShow"),
  }[booking.status];

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          {t("with", { business: tenant.name })}
        </p>
        <h1 className="text-xl font-semibold" style={{ color: accent }}>
          {t("manageTitle")}
        </h1>
      </header>

      <section className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
        <p className="font-medium">{type.name}</p>
        <p>{formatDateTime(booking.startsAt, locale, tenant.timezone)}</p>
        {type.locationDetail ? <p className="text-muted-foreground">{type.locationDetail}</p> : null}
        <p className="text-muted-foreground">{statusLabel}</p>
      </section>

      {booking.status === "cancelled" ? (
        <p className="text-sm text-muted-foreground">{t("cancelledBody")}</p>
      ) : canCancel ? (
        <div className="flex flex-col gap-3">
          {/* Moving the appointment is bounded by the same cutoff as
              cancelling it — `canCancel` is that cutoff — and refused again
              server-side, so a stale page cannot walk around it. A paused
              booking type has no public page to pick slots from, so the
              option is simply not offered. */}
          {type.isActive ? (
            <RescheduleSection
              token={token}
              tenantSlug={tenant.slug}
              typeSlug={type.slug}
              timeZone={tenant.timezone}
              locale={locale}
              accent={accent}
              labels={{
                chooseDay: t("chooseDay"),
                chooseTime: t("chooseTime"),
                noSlots: t("noSlots"),
                previousMonth: t("previousMonth"),
                nextMonth: t("nextMonth"),
                errorGeneric: t("errorGeneric"),
                rateLimited: tShared("rateLimited"),
                rescheduleAction: t("rescheduleAction"),
                rescheduleTitle: t("rescheduleTitle"),
                rescheduleConfirm: t("rescheduleConfirm"),
                rescheduleClose: t("rescheduleClose"),
                errors: {
                  slotTaken: t("errorSlotTaken"),
                  sameSlot: t("errorSameSlot"),
                  cutoff: t("cancelCutoff"),
                  rateLimited: tShared("rateLimited"),
                  generic: t("errorGeneric"),
                },
              }}
            />
          ) : null}
          <form action={cancelBookingAction.bind(null, token)}>
            <button
              type="submit"
              className="rounded-md border border-destructive px-4 py-2 text-sm text-destructive"
            >
              {t("cancelAction")}
            </button>
          </form>
        </div>
      ) : booking.status === "confirmed" ? (
        // The hard cutoff is what stops an 08:55 cancellation for a 09:00
        // slot; past it the page says to get in touch rather than pretending
        // the button might work.
        <p className="text-sm text-muted-foreground">{t("cancelCutoff")}</p>
      ) : null}
    </main>
  );
}
