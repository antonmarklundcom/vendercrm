import { BookingView } from "../../booking-view";

// The public booking page (docs/SPEC-BOOKING.md §5). The body is shared with
// the embeddable iframe route `/b/e/...`, so a change to the booking form
// reaches both (plan-booking.md §6.2).

export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; typeSlug: string }>;
}) {
  const { tenantSlug, typeSlug } = await params;
  return (
    <main>
      <BookingView tenantSlug={tenantSlug} typeSlug={typeSlug} />
    </main>
  );
}
