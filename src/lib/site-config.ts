import { SITE_URL } from "@/lib/config/hosts";

/**
 * Single source of truth for every launch-day *content* detail of the
 * clientes.com.py marketing site (MARKETING_SITE_PLAN.md §1.2, "TBD
 * details"). The hostnames that used to live here moved to
 * `lib/config/hosts.ts` — infrastructure the middleware needs has no
 * business sitting next to the owner's RUC (PLAN.md §14 I2 #3).
 *
 * Everything the owner still has to supply lives in `contact` below as an
 * explicit `null` with a TODO next to it. `null` is deliberate rather than a
 * dummy string: the components read these through the helpers at the bottom
 * and simply omit the element when a detail is missing, so the site never
 * renders a placeholder phone number or a wa.me link pointing at a number
 * nobody owns. Filling them in is a one-file edit (PLAN.md §12).
 */

export const siteConfig = {
  name: "clientes.com.py",
  /** Used by `generateMetadata` in the SEO step; kept here so it moves with the rest. */
  url: SITE_URL,
  locale: "es-PY",
} as const;

/**
 * Home hero background loop. TODO(owner): this points at the Higgsfield
 * generation CDN — fine for review, but download it and serve it from
 * /public/videos/hero-loop.mp4 before launch so the hero doesn't depend on a
 * third party's URL staying valid indefinitely. (The sandbox this was built
 * in couldn't reach that CDN to do the download itself — see build notes.)
 */
export const HERO_VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_349VrHjTFIpx9q71lpfpAXcLXvR/hf_20260905_033405_0a8f4e5a-079f-4e9c-a77c-75a2a8ffa438.mp4";

export const contact = {
  whatsappNumber: "595995628862" as string | null,

  // TODO(owner): landline / mobile shown in the header and footer.
  // `phoneE164` feeds the tel: href, `phoneDisplay` is what the visitor reads.
  phoneE164: null as string | null,
  phoneDisplay: null as string | null,

  // TODO(owner): contact address shown in the footer.
  email: null as string | null,

  // TODO(owner): physical address, one line. Omitted from the footer while null.
  address: null as string | null,

  // TODO(owner): RUC, shown in the trust ribbon as proof this is a real company.
  ruc: null as string | null,
} as const;

/**
 * WhatsApp deep link with a prefilled message that names the page it came
 * from, so conversations are self-attributing even before analytics exists
 * (`web-design-system`, analytics-prep §5). Returns null when no number is
 * configured — callers render the form CTA alone rather than a broken link.
 */
export function whatsappHref(prefilledMessage: string): string | null {
  if (!contact.whatsappNumber) return null;
  return `https://wa.me/${contact.whatsappNumber}?text=${encodeURIComponent(prefilledMessage)}`;
}

export function telHref(): string | null {
  return contact.phoneE164 ? `tel:${contact.phoneE164}` : null;
}
