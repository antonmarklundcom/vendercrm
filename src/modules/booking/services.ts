import { and, asc, eq } from "drizzle-orm";
import { bookingTypeServices } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import type { BookedService } from "./service-totals";

// Add-on services (plan-booking.md §5.2): "barba +15 min", "lavado +10.000".
//
// They are add-ons to a booking *type*, not types of their own, because the
// alternative — a type per combination — multiplies: a barbería with three
// add-ons would publish eight booking pages. One page, checkboxes, and the
// duration the slot search uses grows with what was ticked.

export type BookingTypeService = typeof bookingTypeServices.$inferSelect;

export async function listServicesForType(
  ctx: TenantContext,
  bookingTypeId: string,
): Promise<BookingTypeService[]> {
  return tenantDb(ctx)
    .select(bookingTypeServices, eq(bookingTypeServices.bookingTypeId, bookingTypeId))
    .orderBy(asc(bookingTypeServices.sort), asc(bookingTypeServices.id));
}

/** Only active add-ons are offered publicly — the same rule as booking types. */
export async function listActiveServicesForType(
  ctx: TenantContext,
  bookingTypeId: string,
): Promise<BookingTypeService[]> {
  const rows = await listServicesForType(ctx, bookingTypeId);
  return rows.filter((row) => row.isActive);
}

export async function createService(
  ctx: TenantContext,
  input: {
    bookingTypeId: string;
    name: string;
    extraDurationMinutes?: number;
    extraPrice?: number | null;
    sort?: number;
  },
): Promise<BookingTypeService | null> {
  const id = newId();
  await tenantDb(ctx)
    .insert(bookingTypeServices)
    .values({
      id,
      bookingTypeId: input.bookingTypeId,
      name: input.name.trim(),
      extraDurationMinutes: Math.max(0, Math.floor(input.extraDurationMinutes ?? 0)),
      extraPrice: input.extraPrice ?? null,
      sort: input.sort ?? 0,
    });
  const [row] = await tenantDb(ctx).select(bookingTypeServices, eq(bookingTypeServices.id, id));
  return row ?? null;
}

export async function deleteService(ctx: TenantContext, id: string): Promise<void> {
  await tenantDb(ctx).delete(bookingTypeServices, eq(bookingTypeServices.id, id));
}

export async function toggleService(
  ctx: TenantContext,
  id: string,
  isActive: boolean,
): Promise<void> {
  await tenantDb(ctx)
    .update(bookingTypeServices)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(bookingTypeServices.id, id));
}

/**
 * Resolves the ids a visitor ticked into the snapshot stored on the booking.
 *
 * Unknown or inactive ids are dropped rather than rejected: they are the
 * shape a stale open tab produces, and refusing the whole reservation over
 * one retired add-on would be the wrong trade. What must not happen is an
 * id from *another tenant* extending a duration here, which is why the
 * lookup is a tenant-scoped query and not a trusted body field.
 */
export async function resolveBookedServices(
  ctx: TenantContext,
  bookingTypeId: string,
  serviceIds: string[],
): Promise<BookedService[]> {
  if (serviceIds.length === 0) return [];
  const wanted = new Set(serviceIds);
  const rows = await tenantDb(ctx).select(
    bookingTypeServices,
    and(
      eq(bookingTypeServices.bookingTypeId, bookingTypeId),
      eq(bookingTypeServices.isActive, true),
    ),
  );
  return rows
    .filter((row) => wanted.has(row.id))
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
    .map((row) => ({
      id: row.id,
      name: row.name,
      extraDurationMinutes: row.extraDurationMinutes,
      extraPrice: row.extraPrice,
    }));
}

export {
  extraDurationOf,
  extraPriceOf,
  type BookedService,
} from "./service-totals";
