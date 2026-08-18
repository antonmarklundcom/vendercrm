/**
 * Single source of truth for every launch-day detail of the clientes.com.py
 * marketing site (MARKETING_SITE_PLAN.md §1.2, "TBD details").
 *
 * Everything the owner still has to supply lives in `contact` below as an
 * explicit `null` with a TODO next to it. `null` is deliberate rather than a
 * dummy string: the components below read these through the helpers at the
 * bottom and simply omit the element when a detail is missing, so the site
 * never renders a placeholder phone number or a wa.me link pointing at a
 * number nobody owns. Filling them in is a one-file edit.
 */

/**
 * What the platform is called anywhere a person can read it — the app shell,
 * the login page, transactional emails.
 *
 * The product name this repo is named after is deliberately not used: it is a
 * working name that was never going to be customer-facing (owner decision,
 * 2026-08-18). The platform is part of the clientes.com.py service, not a
 * separate product a customer bought, so it carries the same name. Change it
 * here and every surface follows.
 */
export const APP_NAME = "Clientes";

export const APEX_HOST = "clientes.com.py";
export const APP_HOST = `crm.${APEX_HOST}`;

export const SITE_URL = `https://${APEX_HOST}`;
export const CRM_URL = `https://${APP_HOST}`;
export const CRM_LOGIN_URL = `${CRM_URL}/login`;

export const siteConfig = {
  name: "clientes.com.py",
  /** Used by `generateMetadata` in the SEO step; kept here so it moves with the rest. */
  url: SITE_URL,
  locale: "es-PY",
} as const;

export const contact = {
  // TODO(owner): WhatsApp number in international format, digits only, no "+"
  // and no spaces — e.g. "595981123456". While this is null every WhatsApp CTA
  // on the site falls back to the contact form instead of rendering a dead link.
  whatsappNumber: null as string | null,

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
