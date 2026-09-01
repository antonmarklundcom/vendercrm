import type { Metadata } from "next";
import { Newsreader } from "next/font/google";
import Script from "next/script";
import { getTranslations } from "next-intl/server";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { JsonLd } from "@/components/marketing/json-ld";
import { CRM_URL, SITE_URL } from "@/lib/config/hosts";
import { contact, siteConfig } from "@/lib/site-config";

// The marketing chrome, kept entirely separate from the app chrome. The `.mk`
// wrapper is what scopes the marketing design tokens (globals.css) — nothing
// in the CRM ever renders inside it.
//
// Two typefaces total: Newsreader for display, and the Geist Sans already
// loaded by the root layout for text. Both via next/font, so no layout shift.

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // No `template` here on purpose: every marketing page writes its own full
  // title, brand included, so the title that ships is exactly the one in
  // messages/es.json and nothing appends a second brand to it.
  title: siteConfig.name,
};

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("marketing.nav");

  return (
    <div className={`mk ${newsreader.variable}`}>
      {/* Organization, once, sitewide (MARKETING_SITE_PLAN.md §5 step 5).
          Contact fields join only once the owner fills site-config — schema
          must never claim details the site doesn't show. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: siteConfig.name,
          url: SITE_URL,
          areaServed: { "@type": "Country", name: "Paraguay" },
          ...(contact.email ? { email: contact.email } : {}),
          ...(contact.phoneE164 ? { telephone: contact.phoneE164 } : {}),
        }}
      />
      <a href="#contenido" className="mk-skip">
        {t("skipToContent")}
      </a>
      <MarketingHeader />
      <main id="contenido">{children}</main>
      <MarketingFooter />

      {/* First-touch attribution: stores the first utm / gclid / fbclid the
          visitor ever arrived with in a 90-day cookie, read server-side by the
          contact action. Without it every lead looks like direct traffic. */}
      <Script src={`${CRM_URL}/vc-attribution.js`} strategy="afterInteractive" />
      {/* Scroll reveal, sticky-header state. Reduced-motion guard is inside. */}
      <Script src="/mk-motion.js" strategy="afterInteractive" />
      {/* Analytics shim: ~350 bytes, loads nothing, pushes every data-ev click
          into dataLayer so GA4/GTM/Plausible can be switched on later with one
          paste and no markup changes. */}
      <Script id="mk-analytics-shim" strategy="afterInteractive">
        {`(function(){window.dataLayer=window.dataLayer||[];document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-ev]');if(!t)return;window.dataLayer.push({event:t.dataset.ev,ev_loc:t.dataset.evLoc||'',page_path:location.pathname,site:location.hostname});},true);})();`}
      </Script>
    </div>
  );
}
