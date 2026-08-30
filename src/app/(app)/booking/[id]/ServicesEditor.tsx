import type { BookingTypeService } from "@/modules/booking/services";
import { Button } from "@/components/ui/button";
import {
  createServiceAction,
  deleteServiceAction,
  toggleServiceAction,
} from "./actions";

// The add-on list for one booking type (plan-booking.md §5.2): "barba +15
// min", "lavado +10.000". Plain server-action forms, no client state — the
// list is short and each row is independent, so a controlled editor would be
// machinery for nothing.

export type ServiceLabels = {
  title: string;
  help: string;
  empty: string;
  name: string;
  extraDuration: string;
  extraPrice: string;
  add: string;
  remove: string;
  active: string;
  inactive: string;
  disabledHint: string;
};

export function ServicesEditor({
  bookingTypeId,
  services,
  allowMultiService,
  labels,
  formatPrice,
}: {
  bookingTypeId: string;
  services: BookingTypeService[];
  allowMultiService: boolean;
  labels: ServiceLabels;
  formatPrice: (value: number) => string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium">{labels.title}</h2>
        <p className="text-sm text-muted-foreground">{labels.help}</p>
        {/* Add-ons that exist but are switched off at the type level would
            be invisible on the public page with no explanation here. */}
        {!allowMultiService && services.length > 0 ? (
          <p className="mt-1 text-sm text-destructive">{labels.disabledHint}</p>
        ) : null}
      </div>

      {services.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {services.map((service) => (
            <li
              key={service.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
            >
              <span>
                {service.name}
                {service.extraDurationMinutes > 0 ? ` · +${service.extraDurationMinutes} min` : ""}
                {service.extraPrice ? ` · ${formatPrice(service.extraPrice)}` : ""}
              </span>
              <span className="flex gap-3">
                <form
                  action={toggleServiceAction.bind(
                    null,
                    bookingTypeId,
                    service.id,
                    !service.isActive,
                  )}
                >
                  <button type="submit" className="text-xs underline">
                    {service.isActive ? labels.active : labels.inactive}
                  </button>
                </form>
                <form action={deleteServiceAction.bind(null, bookingTypeId, service.id)}>
                  <button type="submit" className="text-xs underline text-destructive">
                    {labels.remove}
                  </button>
                </form>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form
        action={createServiceAction.bind(null, bookingTypeId)}
        className="flex flex-wrap items-end gap-2"
      >
        <label className="flex flex-col gap-1 text-sm">
          {labels.name}
          <input name="name" className="rounded-md border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {labels.extraDuration}
          <input
            name="extraDurationMinutes"
            type="number"
            min={0}
            defaultValue={0}
            className="w-24 rounded-md border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {labels.extraPrice}
          <input
            name="extraPrice"
            type="number"
            min={0}
            step={1}
            className="w-32 rounded-md border px-3 py-2"
          />
        </label>
        <Button type="submit" size="sm" variant="outline">
          {labels.add}
        </Button>
      </form>
    </section>
  );
}
