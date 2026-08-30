import { BookingView } from "../../../booking-view";
import { EMBED_ROOT_ID, EmbedHeight } from "./embed-height";

// The iframe document behind `public/b.js` (plan-booking.md §6.2), mirroring
// the chat widget's `/w/[widgetKey]`.
//
// Served from the CRM's own origin and embedded by b.js, so every request the
// booking form makes is same-origin — which is what lets the widget exist
// without opening a CORS surface, exactly as the chat widget does.
//
// Unlike the chat widget there is no key and no origin allowlist here, and
// deliberately: `/b/<tenant>/<type>` is already a public page anybody may
// open or link to, so refusing to render the same content inside an iframe
// would protect nothing. What the page can do is unchanged — the reserve
// endpoint keeps its own rate limits, honeypot and Turnstile.

export default async function BookingEmbedFrame({
  params,
}: {
  params: Promise<{ tenantSlug: string; typeSlug: string }>;
}) {
  const { tenantSlug, typeSlug } = await params;

  return (
    <>
      <EmbedHeight />
      {/* The measured element: the form's own box, which is the only thing
          here that is not stretched to the iframe by the app's layout. */}
      <div id={EMBED_ROOT_ID}>
        <BookingView tenantSlug={tenantSlug} typeSlug={typeSlug} embedded />
      </div>
    </>
  );
}
