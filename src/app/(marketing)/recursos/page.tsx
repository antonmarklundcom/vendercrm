import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Eyebrow, Lead, Section } from "@/components/marketing/primitives";
import { CtaBand } from "@/components/marketing/cta-band";
import { JsonLd } from "@/components/marketing/json-ld";
import { SITE_URL } from "@/lib/config/hosts";
import { siteConfig } from "@/lib/site-config";
import { articleClusters } from "@/content/recursos";

// The content hub (MARKETING_SITE_PLAN.md §7, phase M2). One cluster per
// vertical, each article funnelling to its vertical page — the hub is a map,
// not a blog roll, so it is grouped by rubro rather than by date.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.recursos.meta");
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: "/recursos" },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: "/recursos",
      type: "website",
      locale: siteConfig.locale,
    },
  };
}

export default async function RecursosPage() {
  const t = await getTranslations("marketing.recursos");
  const tCommon = await getTranslations("marketing");
  const tVerticals = await getTranslations("marketing.soluciones");
  const clusters = articleClusters();

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: t("meta.title"),
          description: t("meta.description"),
          url: `${SITE_URL}/recursos`,
          isPartOf: { "@type": "WebSite", name: siteConfig.name, url: SITE_URL },
        }}
      />

      <section className="mk-section" aria-labelledby="mk-recursos-title">
        <div className="mk-wrap mk-offset">
          <Eyebrow>{t("header.eyebrow")}</Eyebrow>
          <h1 id="mk-recursos-title">{t("header.title")}</h1>
          <Lead>{t("header.lead")}</Lead>
          <p>{t("header.body")}</p>
        </div>
      </section>

      {clusters.map((cluster, index) => (
        <Section
          key={cluster.vertical}
          tone={index % 2 === 1 ? "surface" : "base"}
          labelledBy={`mk-cluster-${cluster.vertical}`}
        >
          <Eyebrow>{t("clusterEyebrow")}</Eyebrow>
          <h2 id={`mk-cluster-${cluster.vertical}`}>{tVerticals(`${cluster.vertical}.name`)}</h2>
          <ul className="mk-articles">
            {cluster.articles.map((article) => (
              <li key={article.slug}>
                <Link href={`/recursos/${article.slug}`}>
                  <span className="mk-articles__title">{article.title}</span>
                </Link>
                <p className="mk-articles__desc">{article.description}</p>
                <span className="mk-articles__meta">
                  {t("readingTime", { minutes: article.readingMinutes })}
                </span>
              </li>
            ))}
          </ul>
          {/* The cluster's whole point: every article funnels to the page
              that sells to that rubro. */}
          <p className="mk-articles__cta">
            <Link href={`/soluciones/${cluster.vertical}`} className="mk-btn mk-btn--ghost">
              {t("verticalLink", { name: tVerticals(`${cluster.vertical}.name`) })}
            </Link>
          </p>
        </Section>
      ))}

      <CtaBand
        eyebrow={tCommon("home.closing.eyebrow")}
        title={tCommon("home.closing.title")}
        body={tCommon("home.closing.body")}
        panelTitle={tCommon("home.closing.panelTitle")}
        panelItems={tCommon.raw("home.closing.panelItems") as string[]}
        cta={{
          primaryLabel: tCommon("cta.primary"),
          whatsappLabel: tCommon("cta.whatsapp"),
          whatsappPrefill: t("waPrefill"),
        }}
      />
    </>
  );
}
