import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Eyebrow, Lead, Section } from "@/components/marketing/primitives";
import { CtaPair } from "@/components/marketing/cta";
import { CtaBand } from "@/components/marketing/cta-band";
import { JsonLd } from "@/components/marketing/json-ld";
import { SITE_URL } from "@/lib/config/hosts";
import { siteConfig } from "@/lib/site-config";
import { ARTICLE_SLUGS, getArticle, relatedArticles, type ArticleBlock } from "@/content/recursos";

// One article template, ten content files (MARKETING_SITE_PLAN.md §7). Static
// at build time — `dynamicParams: false`, so an unknown slug is a 404 rather
// than an empty page that Google can index.

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return ARTICLE_SLUGS.map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) return {};

  const path = `/recursos/${article.slug}`;
  return {
    title: article.metaTitle,
    description: article.description,
    alternates: { canonical: path },
    openGraph: {
      title: article.title,
      description: article.description,
      url: path,
      type: "article",
      locale: siteConfig.locale,
      modifiedTime: article.updated,
    },
  };
}

function Block({ block }: { block: ArticleBlock }) {
  switch (block.kind) {
    case "h2":
      return <h2>{block.text}</h2>;
    case "p":
      return <p>{block.text}</p>;
    case "list":
      return (
        <ul className="mk-list">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "callout":
      return <p className="mk-article__callout">{block.text}</p>;
    case "math":
      // A worked example, rendered as a table so the arithmetic is scannable
      // on a phone instead of buried in a paragraph.
      return (
        <div className="mk-article__math">
          <h3>{block.title}</h3>
          <dl>
            {block.rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mk-article__math-note">{block.note}</p>
        </div>
      );
  }
}

export default async function ArticlePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  const t = await getTranslations("marketing.recursos");
  const tCommon = await getTranslations("marketing");
  const tVerticals = await getTranslations("marketing.soluciones");
  const related = relatedArticles(article);
  const pageUrl = `${SITE_URL}/recursos/${article.slug}`;
  const verticalName = tVerticals(`${article.vertical}.name`);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: article.title,
          description: article.description,
          url: pageUrl,
          inLanguage: "es-PY",
          dateModified: article.updated,
          datePublished: article.updated,
          author: { "@type": "Organization", name: siteConfig.name, url: SITE_URL },
          publisher: { "@type": "Organization", name: siteConfig.name, url: SITE_URL },
          mainEntityOfPage: { "@type": "WebPage", "@id": pageUrl },
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
              name: tVerticals("common.breadcrumbHome"),
              item: SITE_URL,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: t("breadcrumb"),
              item: `${SITE_URL}/recursos`,
            },
            { "@type": "ListItem", position: 3, name: article.title, item: pageUrl },
          ],
        }}
      />

      <section className="mk-section" aria-labelledby="mk-article-title">
        <div className="mk-wrap mk-offset">
          <Eyebrow>{article.eyebrow}</Eyebrow>
          <h1 id="mk-article-title">{article.title}</h1>
          <Lead>{article.lead}</Lead>
          <p className="mk-articles__meta">
            {t("readingTime", { minutes: article.readingMinutes })} ·{" "}
            {t("updated", { date: article.updated })}
          </p>
        </div>
      </section>

      <section className="mk-section mk-section--tight" aria-label={article.title}>
        <div className="mk-wrap">
          <article className="mk-article">
            {article.body.map((block, index) => (
              <Block key={index} block={block} />
            ))}
          </article>
        </div>
      </section>

      {/* The link this whole cluster exists to make (§7): the article funnels
          to the page that sells to its rubro. */}
      <Section tone="surface" tight labelledBy="mk-article-vertical">
        <Eyebrow>{t("verticalEyebrow")}</Eyebrow>
        <p id="mk-article-vertical" style={{ marginBottom: "1rem" }}>
          {t("verticalLead", { name: verticalName })}
        </p>
        <CtaPair
          primaryLabel={t("verticalLink", { name: verticalName })}
          primaryHref={`/soluciones/${article.vertical}`}
          whatsappLabel={tCommon("cta.whatsapp")}
          whatsappPrefill={article.waPrefill}
          location={`recursos-${article.slug}`}
        />
      </Section>

      <Section tight labelledBy="mk-article-related">
        <Eyebrow>{t("relatedEyebrow")}</Eyebrow>
        <h2 id="mk-article-related">{t("relatedTitle")}</h2>
        <ul className="mk-articles">
          {related.map((sibling) => (
            <li key={sibling.slug}>
              <Link href={`/recursos/${sibling.slug}`}>
                <span className="mk-articles__title">{sibling.title}</span>
              </Link>
              <p className="mk-articles__desc">{sibling.description}</p>
            </li>
          ))}
        </ul>
        <p className="mk-articles__cta">
          <Link href="/recursos" className="mk-btn mk-btn--ghost">
            {t("backToHub")}
          </Link>
        </p>
      </Section>

      <CtaBand
        eyebrow={tCommon("home.closing.eyebrow")}
        title={tCommon("home.closing.title")}
        body={tCommon("home.closing.body")}
        panelTitle={tCommon("home.closing.panelTitle")}
        panelItems={tCommon.raw("home.closing.panelItems") as string[]}
        cta={{
          primaryLabel: tCommon("cta.primary"),
          whatsappLabel: tCommon("cta.whatsapp"),
          whatsappPrefill: article.waPrefill,
        }}
      />
    </>
  );
}
