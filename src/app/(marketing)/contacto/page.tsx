import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Eyebrow, Lead, MarkedList } from "@/components/marketing/primitives";
import { ContactForm, type ContactFormCopy } from "@/components/marketing/contact-form";
import { WhatsAppLink } from "@/components/marketing/cta";
import { TrustRibbon } from "@/components/marketing/trust-ribbon";
import { Faq, type FaqItem } from "@/components/marketing/faq";
import { contact } from "@/lib/site-config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.contacto.meta");
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: "/contacto" },
  };
}

export default async function ContactoPage({
  searchParams,
}: {
  searchParams: Promise<{ enviado?: string; error?: string }>;
}) {
  const t = await getTranslations("marketing");
  const params = await searchParams;
  const sent = params.enviado === "1";
  const phoneError = params.error === "telefono";

  const formCopy: ContactFormCopy = {
    name: t("contacto.form.name"),
    company: t("contacto.form.company"),
    phone: t("contacto.form.phone"),
    phonePlaceholder: t("contacto.form.phonePlaceholder"),
    phoneHint: t("contacto.form.phoneHint"),
    emailOptional: t("contacto.form.emailOptional"),
    sector: t("contacto.form.sector"),
    sectorPlaceholder: t("contacto.form.sectorPlaceholder"),
    sectorOptions: t.raw("contacto.form.sectorOptions") as string[],
    messageOptional: t("contacto.form.messageOptional"),
    submit: t("contacto.form.submit"),
    privacy: t("contacto.form.privacy"),
    honeypotLabel: t("contacto.form.honeypotLabel"),
  };

  // Pattern map: header + form P1 mirrored 5/7 · ribbon P8 · faq P4.
  return (
    <>
      <section className="mk-section" aria-labelledby="mk-contacto-title">
        <div className="mk-wrap">
          <div style={{ maxWidth: "48rem" }}>
            <Eyebrow>{t("contacto.header.eyebrow")}</Eyebrow>
            <h1 id="mk-contacto-title">{t("contacto.header.title")}</h1>
            <Lead>{t("contacto.header.lead")}</Lead>
          </div>

          <div className="mk-split mk-split--mirror" style={{ marginTop: "3rem", alignItems: "start" }}>
            <aside className="mk-card mk-card--hair">
              <h2 className="mk-h3">{t("contacto.aside.title")}</h2>
              <MarkedList items={t.raw("contacto.aside.steps") as string[]} />

              <h2 className="mk-h3" style={{ marginTop: "2rem" }}>{t("contacto.aside.pricingTitle")}</h2>
              <p>{t("contacto.aside.pricingBody")}</p>

              {/* Rendered only when a WhatsApp number is configured. */}
              {contact.whatsappNumber ? (
                <>
                  <h2 className="mk-h3" style={{ marginTop: "2rem" }}>{t("contacto.aside.whatsappTitle")}</h2>
                  <p>{t("contacto.aside.whatsappBody")}</p>
                  <WhatsAppLink
                    label={t("cta.whatsapp")}
                    prefill={t("cta.waPrefill")}
                    location="contacto"
                  />
                </>
              ) : null}
            </aside>

            <div className="mk-card mk-card--raised">
              {sent ? (
                <div>
                  <h2 style={{ fontSize: "var(--mk-t-2)" }}>{t("contacto.success.title")}</h2>
                  <p>{t("contacto.success.body")}</p>
                  <div className="mk-cta-pair">
                    <WhatsAppLink
                      label={t("cta.whatsapp")}
                      prefill={t("cta.waPrefill")}
                      location="gracias"
                    />
                    <Link href="/" className="mk-btn mk-btn--ghost">
                      {t("contacto.success.backLabel")}
                    </Link>
                  </div>
                </div>
              ) : (
                <>
                  {phoneError ? (
                    <div className="mk-notice" role="alert">
                      <p>{t("contacto.errors.phone")}</p>
                    </div>
                  ) : null}
                  <ContactForm copy={formCopy} />
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <TrustRibbon
        items={[
          t("ribbon.monthly"),
          t("ribbon.measured"),
          t("ribbon.ownData"),
          ...(contact.ruc ? [t("ribbon.ruc", { ruc: contact.ruc })] : []),
        ]}
      />

      <Faq
        title={t("contacto.faq.title")}
        items={t.raw("contacto.faq.items") as FaqItem[]}
        id="mk-contacto-faq"
      />
    </>
  );
}
