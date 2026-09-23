import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CRM_LOGIN_URL } from "@/lib/config/hosts";
import { contact, telHref } from "@/lib/site-config";
import { MobileMenu } from "./mobile-menu";

// `data-sticky-header` is read by mk-motion.js, which toggles `is-stuck`
// past 24px of scroll — the hairline under the header appears only once the
// page has moved.

export async function MarketingHeader() {
  const t = await getTranslations("marketing.nav");
  const tCta = await getTranslations("marketing.cta");
  const tel = telHref();
  const links = [
    { href: "/metodo", label: t("metodo") },
    { href: "/recursos", label: t("recursos") },
    { href: "/nosotros", label: t("nosotros") },
    { href: "/contacto", label: t("contacto") },
  ];

  return (
    <header className="mk-header" data-sticky-header>
      <div className="mk-wrap mk-header__inner">
        <Link href="/" className="mk-wordmark">
          clientes<span>.com.py</span>
        </Link>

        <nav className="mk-nav" aria-label={t("menu")}>
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="mk-header__actions">
          {/* Rendered only once the owner has supplied a number. */}
          {tel && contact.phoneDisplay ? (
            <a
              href={tel}
              className="mk-login"
              data-ev="call_click"
              data-ev-loc="header"
            >
              {contact.phoneDisplay}
            </a>
          ) : null}
          {/* Quiet ghost text link, never a CTA button (locked decision). */}
          <a href={CRM_LOGIN_URL} className="mk-login" rel="nofollow">
            {t("login")}
          </a>
          {/* The one primary action, reachable from every scroll position.
              "Ingresar" above stays a quiet text link — this is for visitors,
              not clients. */}
          <Link
            href="/contacto"
            className="mk-btn mk-btn--primary mk-header__cta"
            data-ev="cta_click"
            data-ev-loc="header"
          >
            {t("cta")}
          </Link>
          <MobileMenu
            label={t("menu")}
            links={links}
            cta={{ href: "/contacto", label: tCta("primary") }}
          />
        </div>
      </div>
    </header>
  );
}
