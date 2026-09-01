import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CRM_LOGIN_URL } from "@/lib/config/hosts";
import { contact, telHref } from "@/lib/site-config";

// `data-sticky-header` is read by mk-motion.js, which toggles `is-stuck`
// past 24px of scroll — the hairline under the header appears only once the
// page has moved.

export async function MarketingHeader() {
  const t = await getTranslations("marketing.nav");
  const tel = telHref();

  return (
    <header className="mk-header" data-sticky-header>
      <div className="mk-wrap mk-header__inner">
        <Link href="/" className="mk-wordmark">
          clientes<span>.com.py</span>
        </Link>

        <nav className="mk-nav" aria-label={t("menu")}>
          <Link href="/metodo">{t("metodo")}</Link>
          <Link href="/recursos">{t("recursos")}</Link>
          <Link href="/nosotros">{t("nosotros")}</Link>
          <Link href="/contacto">{t("contacto")}</Link>
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
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
        </div>
      </div>
    </header>
  );
}
