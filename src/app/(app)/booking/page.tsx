import { CalendarClock } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateTime } from "@/lib/i18n/format";
import { env } from "@/lib/config/env";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import { listUsersForTenant } from "@/modules/tenancy/users";
import { listBookingTypes } from "@/modules/booking/types";
import {
  listAvailabilityRules,
  listBlackouts,
  listResources,
  listResourcesForType,
} from "@/modules/booking/resources";
import { listBookings } from "@/modules/booking/bookings";
import { notificationsByBooking } from "@/modules/booking/notifications";
import { getContact } from "@/modules/crm/contacts";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { BookingDelivery, type DeliveryLabels } from "./BookingDelivery";
import {
  AvailabilityForm,
  NewBlackoutForm,
  NewBookingTypeForm,
  NewResourceForm,
  TypeResourcesPicker,
} from "./BookingForms";
import {
  cancelBookingByStaffAction,
  confirmDepositAction,
  rejectDepositAction,
  deleteBlackoutAction,
  markNoShowAction,
  toggleBookingTypeAction,
  toggleResourceAction,
} from "./actions";

// Booking configuration (docs/SPEC-BOOKING.md §6). Tenant configuration, so
// admin-only for the same reason /sites is — and the nav hides it from an
// agent rather than showing a page whose every button throws.

export default async function BookingPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.booking");
  const locale = await getLocale();

  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const [tenant, types, resources, members, upcoming] = await Promise.all([
    getTenant(ctx.tenantId),
    listBookingTypes(ctx),
    listResources(ctx),
    listUsersForTenant(ctx.tenantId),
    listBookings(ctx, { from: new Date() }),
  ]);

  const rules = await listAvailabilityRules(ctx);
  // Only closures that have not already finished: a holiday from two years
  // ago is history the slot generator no longer consults, and a list that
  // grows forever is not a list anyone reads.
  const now = new Date();
  const blackouts = (await listBlackouts(ctx))
    .filter((blackout) => blackout.endsAt > now)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const typeResources = await Promise.all(
    types.map(async (type) => [type.id, await listResourcesForType(ctx, type.id)] as const),
  );
  const resourcesByType = new Map(typeResources);

  const contacts = new Map(
    await Promise.all(
      [...new Set(upcoming.map((booking) => booking.contactId))].map(
        async (id) => [id, await getContact(ctx, id)] as const,
      ),
    ),
  );

  // What the customer was actually told, per booking (plan-booking.md §5.1).
  const deliveries = await notificationsByBooking(
    ctx,
    upcoming.map((booking) => booking.id),
  );

  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((day) => t(`weekday${day}` as "weekday0"));
  const deliveryLabels: DeliveryLabels = {
    title: t("deliveryTitle"),
    empty: t("deliveryEmpty"),
    never: t("deliveryNever"),
    kind: {
      confirmation: t("deliveryKind.confirmation"),
      reminder: t("deliveryKind.reminder"),
      cancellation: t("deliveryKind.cancellation"),
      reschedule: t("deliveryKind.reschedule"),
      deposit_request: t("deliveryKind.deposit_request"),
      review_request: t("deliveryKind.review_request"),
    },
    channel: {
      wa_template: t("deliveryChannel.wa_template"),
      wa_freeform: t("deliveryChannel.wa_freeform"),
      email: t("deliveryChannel.email"),
      none: t("deliveryChannel.none"),
    },
    status: {
      queued: t("deliveryStatus.queued"),
      sent: t("deliveryStatus.sent"),
      delivered: t("deliveryStatus.delivered"),
      read: t("deliveryStatus.read"),
      failed: t("deliveryStatus.failed"),
      skipped: t("deliveryStatus.skipped"),
    },
    detail: {
      no_channel: t("deliveryDetail.no_channel"),
      template_not_approved_and_window_closed: t(
        "deliveryDetail.template_not_approved_and_window_closed",
      ),
      email_not_delivered: t("deliveryDetail.email_not_delivered"),
      booking_context_missing: t("deliveryDetail.booking_context_missing"),
      booking_not_found: t("deliveryDetail.booking_not_found"),
      tenant_not_found: t("deliveryDetail.tenant_not_found"),
    },
  };
  const errorLabels = {
    nameRequired: t("errors.nameRequired"),
    slugTaken: t("errors.slugTaken"),
    durationInvalid: t("errors.durationInvalid"),
    invalidTime: t("errors.invalidTime"),
    invalidRange: t("errors.invalidRange"),
    invalidDate: t("errors.invalidDate"),
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("title")} description={t("intro")} />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">{t("typesTitle")}</h2>
        <NewBookingTypeForm
          labels={{
            name: t("name"),
            slug: t("slug"),
            duration: t("duration"),
            create: t("createType"),
            errors: errorLabels,
          }}
        />

        {types.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={t("typesTitle")}
            description={t("typesEmpty")}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {types.map((type) => (
              <li key={type.id} className="flex flex-col gap-2 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{type.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("duration", { minutes: type.durationMinutes })}
                    </p>
                  </div>
                  <form action={toggleBookingTypeAction.bind(null, type.id, !type.isActive)}>
                    <button type="submit" className="text-xs underline">
                      {type.isActive ? t("active") : t("inactive")}
                    </button>
                  </form>
                </div>
                <a
                  className="text-sm underline"
                  href={`${env.APP_URL}/b/${tenant?.slug}/${type.slug}`}
                >
                  {`${env.APP_URL}/b/${tenant?.slug}/${type.slug}`}
                </a>
                <a className="text-sm underline" href={`/booking/${type.id}`}>
                  {t("configure")}
                </a>
                <TypeResourcesPicker
                  bookingTypeId={type.id}
                  resources={resources.map((resource) => ({
                    id: resource.id,
                    name: resource.name,
                  }))}
                  selected={(resourcesByType.get(type.id) ?? []).map((resource) => resource.id)}
                  label={t("resourcesTitle")}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-medium">{t("resourcesTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("resourcesIntro")}</p>
        </div>
        <NewResourceForm
          labels={{
            name: t("resourceName"),
            kindUser: t("resourceKindUser"),
            kindResource: t("resourceKindResource"),
            user: t("resourceUser"),
            none: "—",
            create: t("newResource"),
            errors: errorLabels,
          }}
          users={members.map((member) => ({
            id: member.id,
            label: member.name || member.email,
          }))}
        />

        {resources.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={t("resourcesTitle")}
            description={t("resourcesEmpty")}
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {resources.map((resource) => {
              const initial: Record<number, Array<{ start: string; end: string }>> = {};
              for (const rule of rules.filter((row) => row.resourceId === resource.id)) {
                initial[rule.weekday] = [
                  ...(initial[rule.weekday] ?? []),
                  { start: rule.startTime, end: rule.endTime },
                ];
              }

              return (
                <li key={resource.id} className="flex flex-col gap-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{resource.name}</p>
                    <form action={toggleResourceAction.bind(null, resource.id, !resource.isActive)}>
                      <button type="submit" className="text-xs underline">
                        {resource.isActive ? t("active") : t("inactive")}
                      </button>
                    </form>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("availabilityTitle", { name: resource.name })} · {t("availabilityIntro")}
                  </p>
                  <AvailabilityForm
                    resourceId={resource.id}
                    initial={initial}
                    labels={{
                      from: t("from"),
                      to: t("to"),
                      addRange: t("addRange"),
                      save: t("saveAvailability"),
                      weekdays,
                      errors: errorLabels,
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-medium">{t("blackoutsTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("blackoutsIntro")}</p>
        </div>
        <NewBlackoutForm
          labels={{
            resource: t("blackoutResource"),
            wholeTenant: t("blackoutWholeTenant"),
            startDate: t("blackoutFrom"),
            endDate: t("blackoutTo"),
            startTime: t("blackoutFromTime"),
            endTime: t("blackoutToTime"),
            timeHelp: t("blackoutTimeHelp"),
            reason: t("blackoutReason"),
            create: t("blackoutCreate"),
            errors: errorLabels,
          }}
          resources={resources.map((resource) => ({
            id: resource.id,
            name: resource.name,
          }))}
        />

        {blackouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("blackoutsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {blackouts.map((blackout) => {
              const who = blackout.resourceId
                ? (resources.find((resource) => resource.id === blackout.resourceId)?.name ??
                  t("blackoutWholeTenant"))
                : t("blackoutWholeTenant");

              return (
                <li
                  key={blackout.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <span>
                    {who} · {formatDateTime(blackout.startsAt, locale, tenant?.timezone)} –{" "}
                    {formatDateTime(blackout.endsAt, locale, tenant?.timezone)}
                    {blackout.reason ? ` · ${blackout.reason}` : ""}
                  </span>
                  <form action={deleteBlackoutAction.bind(null, blackout.id)}>
                    <button type="submit" className="text-xs underline text-destructive">
                      {t("blackoutDelete")}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t("upcomingTitle")}</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("upcomingEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.map((booking) => {
              const contact = contacts.get(booking.contactId);
              const statusLabel = {
                confirmed: t("statusConfirmed"),
                pending_deposit: t("statusPendingDeposit"),
                cancelled: t("statusCancelled"),
                completed: t("statusCompleted"),
                no_show: t("statusNoShow"),
              }[booking.status];

              return (
                <li
                  key={booking.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <span className="flex flex-col gap-1">
                    <span>
                      {formatDateTime(booking.startsAt, locale, tenant?.timezone)} ·{" "}
                      {contact?.name ?? "—"} · {statusLabel}
                      {booking.partySize > 1 ? ` · ${t("partySize", { count: booking.partySize })}` : ""}
                      {((booking.services as Array<{ name: string }> | null) ?? [])
                        .map((service) => ` · ${service.name}`)
                        .join("")}
                    </span>
                    <BookingDelivery
                      notifications={deliveries.get(booking.id) ?? []}
                      labels={deliveryLabels}
                      formatWhen={(value) => formatDateTime(value, locale, tenant?.timezone)}
                    />
                  </span>
                  {booking.status === "pending_deposit" ? (
                    // The seña decision sits where the booking is, not behind
                    // a separate queue: staff see "pendiente" on the row and
                    // act on the same row.
                    <span className="flex gap-3">
                      <form action={confirmDepositAction.bind(null, booking.id)}>
                        <button type="submit" className="text-xs underline">
                          {t("confirmDeposit")}
                        </button>
                      </form>
                      <form action={rejectDepositAction.bind(null, booking.id)}>
                        <button type="submit" className="text-xs underline text-destructive">
                          {t("rejectDeposit")}
                        </button>
                      </form>
                    </span>
                  ) : booking.status === "confirmed" ? (
                    <span className="flex gap-3">
                      <form action={markNoShowAction.bind(null, booking.id)}>
                        <button type="submit" className="text-xs underline">
                          {t("markNoShow")}
                        </button>
                      </form>
                      <form action={cancelBookingByStaffAction.bind(null, booking.id)}>
                        <button type="submit" className="text-xs underline text-destructive">
                          {t("cancel")}
                        </button>
                      </form>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
