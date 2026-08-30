import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getPublicBookingType } from "@/modules/booking/public";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { clientIp } from "@/lib/http/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTranslator } from "@/lib/i18n/translator";
import { formatMoney } from "@/lib/i18n/format";
import { BookingPicker } from "./picker";

// The public booking page (docs/SPEC-BOOKING.md §5). Same shape as the public
// quote view /q/[token] and the hosted form pages: server-rendered, the
// tenant's branding and the tenant's language — this is the tenant's artifact
// shown to their customer, not the reader's own app (§13 H5 #4).

export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; typeSlug: string }>;
}) {
  const { tenantSlug, typeSlug } = await params;

  const ip = clientIp(await headers());
  if (checkRateLimit(`booking-page:${ip}`, 60, 60_000).limited) {
    const tLimit = await getTranslator(null, "public.shared");
    return (
      <main className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">
        {tLimit("rateLimited")}
      </main>
    );
  }

  const resolved = await getPublicBookingType(tenantSlug, typeSlug);
  if (!resolved) notFound();

  const { type, questions, turnstileSiteKey, timeZone, services } = resolved;
  const tenant = await getTenant(resolved.tenant.id);
  const branding = ((tenant?.settings ?? {}) as TenantSettings).branding ?? {};
  const accent = branding.primaryColor || undefined;
  const locale = tenant?.locale ?? "es";
  const t = await getTranslator(locale, "public.booking");

  const locationLabel = {
    in_person: t("locationInPerson"),
    phone: t("locationPhone"),
    video: t("locationVideo"),
    whatsapp: t("locationWhatsapp"),
  }[type.locationMode];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        {branding.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied external URL, no loader configured
          <img src={branding.logoUrl} alt={tenant?.name ?? ""} className="max-h-12 self-start" />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("with", { business: tenant?.name ?? "" })}
          </p>
        )}
        <h1 className="text-2xl font-semibold" style={{ color: accent }}>
          {type.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("duration", { minutes: type.durationMinutes })} · {locationLabel}
          {type.locationDetail ? ` · ${type.locationDetail}` : ""}
        </p>
        {type.description ? <p className="text-sm">{type.description}</p> : null}
      </header>

      <BookingPicker
        tenantSlug={tenantSlug}
        typeSlug={typeSlug}
        timeZone={timeZone}
        locale={locale}
        questions={questions}
        turnstileSiteKey={turnstileSiteKey}
        accent={accent}
        services={services.map((service) => ({
          id: service.id,
          name: service.name,
          extraDurationMinutes: service.extraDurationMinutes,
          extraPrice: service.extraPrice,
        }))}
        capacity={type.capacity}
        depositAmount={
          type.depositAmount
            ? formatMoney(type.depositAmount, type.depositCurrency, locale)
            : null
        }
        labels={{
          chooseDay: t("chooseDay"),
          chooseTime: t("chooseTime"),
          noSlots: t("noSlots"),
          previousMonth: t("previousMonth"),
          nextMonth: t("nextMonth"),
          yourData: t("yourData"),
          name: t("name"),
          phone: t("phone"),
          email: t("email"),
          message: t("message"),
          submit: t("submit"),
          confirmedTitle: t("confirmedTitle"),
          manageHint: t("manageHint"),
          errorSlotTaken: t("errorSlotTaken"),
          errorGeneric: t("errorGeneric"),
          servicesTitle: t("servicesTitle"),
          partySize: t("partySize"),
          seatsRemaining: t("seatsRemaining", { count: "{count}" }),
          depositTitle: t("depositTitle"),
          depositBody: t("depositBody", { amount: "{amount}" }),
          errorPartyTooLarge: t("errorPartyTooLarge"),
          rateLimited: (await getTranslator(locale, "public.shared"))("rateLimited"),
        }}
      />
    </main>
  );
}
