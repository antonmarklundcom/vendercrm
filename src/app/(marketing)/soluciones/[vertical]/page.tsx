import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Eyebrow, Lead, Section } from "@/components/marketing/primitives";
import { CtaPair } from "@/components/marketing/cta";
import { TrustRibbon } from "@/components/marketing/trust-ribbon";
import { ProblemSection } from "@/components/marketing/problem-section";
import { MethodRail, type MethodStep } from "@/components/marketing/method-steps";
import { VerticalCards, type VerticalItem } from "@/components/marketing/vertical-cards";
import { Statement } from "@/components/marketing/statement";
import { Faq, type FaqItem } from "@/components/marketing/faq";
import { CtaBand } from "@/components/marketing/cta-band";
import { JsonLd } from "@/components/marketing/json-ld";
import { SITE_URL, contact, siteConfig } from "@/lib/site-config";
import { MARKETING_VERTICALS, isMarketingVertical } from "../verticals";

// The five vertical sales pages: one template, five content configs
// (MARKETING_SITE_PLAN.md §2). Everything vertical-specific lives in
// messages/*.json under `marketing.soluciones.<slug>` — this file only
// composes the shared sections.
//
// Section → pattern map (web-design-system step 2), no two consecutive
// sections sharing a pattern:
//   header P2 offset · ribbon P8 full-bleed · pains P4 editorial
//   method P5 rail (ink) · outcomes P3 staggered · statement P9
//   faq P4 · other-verticals hairline row · closing overlap + ink band

type Params = { vertical: string };

export function generateStaticParams(): Params[] {
  return MARKETING_VERTICALS.map((vertical) => ({ vertical }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { vertical } = await params;
  if (!isMarketingVertical(vertical)) return {};

  const t = await getTranslations(`marketing.soluciones.${vertical}.meta`);
  const path = `/soluciones/${vertical}`;
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: path },
    // Explicit og fields: links to these pages get shared in WhatsApp, where
    // the preview card is the ad (seo-web-builds §6).
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: path,
      type: "website",
      locale: siteConfig.locale,
    },
  };
}

export default async function VerticalPage({ params }: { params: Promise<Params> }) {
  const { vertical } = await params;
  if (!isMarketingVertical(vertical)) notFound();

  const t = await getTranslations(`marketing.soluciones.${vertical}`);
  const tCommon = await getTranslations("marketing");
  const cta = {
    primaryLabel: tCommon("cta.primary"),
    whatsappLabel: tCommon("cta.whatsapp"),
    // Vertical-specific prefill, so a WhatsApp conversation names the rubro
    // it came from before anyone asks.
    whatsappPrefill: t("waPrefill"),
  };

  const faqItems = t.raw("faq.items") as FaqItem[];
  const pageUrl = `${SITE_URL}/soluciones/${vertical}`;

  const others = MARKETING_VERTICALS.filter((slug) => slug !== vertical);
  const tAll = await getTranslations("marketing.soluciones");

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: t("header.title"),
          description: t("meta.description"),
          serviceType: "Consultoría de crecimiento comercial",
          url: pageUrl,
          areaServed: { "@type": "Country", name: "Paraguay" },
          provider: {
            "@type": "Organization",
            name: siteConfig.name,
            url: SITE_URL,
          },
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: tAll("common.breadcrumbHome"),
              item: SITE_URL,
            },
            { "@type": "ListItem", position: 2, name: t("name"), item: pageUrl },
          ],
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqItems.map((item) => ({
            "@type": "Question",
            name: item.q,
            acceptedAnswer: { "@type": "Answer", text: item.a },
          })),
        }}
      />

      <section className="mk-section" aria-labelledby="mk-vertical-title">
        <div className="mk-wrap mk-offset">
          <Eyebrow>{t("header.eyebrow")}</Eyebrow>
          <h1 id="mk-vertical-title">{t("header.title")}</h1>
          <Lead>{t("header.lead")}</Lead>
          <p>{t("header.body")}</p>
          <CtaPair
            primaryLabel={cta.primaryLabel}
            whatsappLabel={cta.whatsappLabel}
            whatsappPrefill={cta.whatsappPrefill}
            location={`hero-${vertical}`}
          />
        </div>
      </section>

      <TrustRibbon
        items={[
          tCommon("ribbon.monthly"),
          tCommon("ribbon.measured"),
          tCommon("ribbon.ownData"),
          ...(contact.ruc ? [tCommon("ribbon.ruc", { ruc: contact.ruc })] : []),
        ]}
      />

      <ProblemSection
        eyebrow={t("pains.eyebrow")}
        title={t("pains.title")}
        body={t("pains.body")}
        bodyTwo={t("pains.bodyTwo")}
        symptomsTitle={t("pains.symptomsTitle")}
        symptoms={t.raw("pains.symptoms") as string[]}
      />

      <MethodRail
        eyebrow={t("method.eyebrow")}
        title={t("method.title")}
        lead={t("method.lead")}
        steps={t.raw("method.steps") as MethodStep[]}
        link={{ href: "/metodo", label: tCommon("home.method.linkLabel") }}
      />

      <VerticalCards
        eyebrow={t("outcomes.eyebrow")}
        title={t("outcomes.title")}
        lead={t("outcomes.lead")}
        items={t.raw("outcomes.items") as VerticalItem[]}
      />

      <Statement text={t("statement.text")} sub={t("statement.sub")} />

      <Faq eyebrow={t("faq.eyebrow")} title={t("faq.title")} items={faqItems} />

      {/* Sibling pages: internal linking for SEO, and the visitor who landed
          on the wrong rubro has somewhere to go other than the back button. */}
      <Section tone="surface" tight labelledBy="mk-other-verticals">
        <Eyebrow>{tAll("common.otherEyebrow")}</Eyebrow>
        <p id="mk-other-verticals" style={{ marginBottom: "1rem" }}>
          {tAll("common.otherLead")}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          {others.map((slug) => (
            <Link key={slug} href={`/soluciones/${slug}`} className="mk-btn mk-btn--ghost">
              {tAll(`${slug}.name`)}
            </Link>
          ))}
        </div>
      </Section>

      <CtaBand
        eyebrow={tCommon("home.closing.eyebrow")}
        title={tCommon("home.closing.title")}
        body={tCommon("home.closing.body")}
        panelTitle={tCommon("home.closing.panelTitle")}
        panelItems={tCommon.raw("home.closing.panelItems") as string[]}
        cta={cta}
      />
    </>
  );
}
