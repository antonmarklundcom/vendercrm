import { MARKETING_VERTICALS, type MarketingVertical } from "@/app/(marketing)/soluciones/verticals";
import { costoPorPacienteNuevo, turnosQueSePierden } from "./clinicas";
import { cuantosPresupuestos, seguimientoDePresupuestos } from "./constructoras";
import { ordenMinimoFichas, velocidadDeRespuesta } from "./inmobiliarias";
import { agendaLlenaFacturacionIrregular, calificarEnDosMinutos } from "./servicios-profesionales";
import { cicloDeVentaLargo, cuandoUnLeadEstaListo } from "./empresas-b2b";
import type { Article, ArticleBlock } from "./types";

export type { Article, ArticleBlock };

// One cluster per vertical (MARKETING_SITE_PLAN.md §7). Display order inside
// a cluster is the order here; the hub groups by vertical using
// MARKETING_VERTICALS so the site's one ordering rule holds everywhere.
export const ARTICLES: Article[] = [
  costoPorPacienteNuevo,
  turnosQueSePierden,
  seguimientoDePresupuestos,
  cuantosPresupuestos,
  velocidadDeRespuesta,
  ordenMinimoFichas,
  agendaLlenaFacturacionIrregular,
  calificarEnDosMinutos,
  cicloDeVentaLargo,
  cuandoUnLeadEstaListo,
];

export const ARTICLE_SLUGS = ARTICLES.map((article) => article.slug);

export function getArticle(slug: string): Article | null {
  return ARTICLES.find((article) => article.slug === slug) ?? null;
}

/** Articles of one vertical, in cluster order. */
export function articlesByVertical(vertical: MarketingVertical): Article[] {
  return ARTICLES.filter((article) => article.vertical === vertical);
}

/** The hub's shape: every vertical, in the site's order, with its cluster. */
export function articleClusters(): Array<{ vertical: MarketingVertical; articles: Article[] }> {
  return MARKETING_VERTICALS.map((vertical) => ({
    vertical,
    articles: articlesByVertical(vertical),
  })).filter((cluster) => cluster.articles.length > 0);
}

export function relatedArticles(article: Article): Article[] {
  return article.related
    .map((slug) => getArticle(slug))
    .filter((related): related is Article => related !== null);
}

// --- Content rules, enforced where they can't be forgotten ----------------
//
// These run at module load, which means at build time: a broken `related`
// slug or a duplicate fails `npm run build` instead of shipping a dead link
// into the sitemap. Cheaper than a test nobody remembers to update, and it
// cannot pass while the site is broken.

const seen = new Set<string>();
for (const article of ARTICLES) {
  if (seen.has(article.slug)) {
    throw new Error(`Two /recursos articles share the slug "${article.slug}"`);
  }
  seen.add(article.slug);
}

for (const article of ARTICLES) {
  // Every article links its vertical page plus 2–3 siblings (§7). The
  // vertical link is rendered by the template; the siblings are these.
  if (article.related.length < 2 || article.related.length > 3) {
    throw new Error(
      `/recursos article "${article.slug}" must link 2–3 siblings, has ${article.related.length}`,
    );
  }
  for (const slug of article.related) {
    if (slug === article.slug) {
      throw new Error(`/recursos article "${article.slug}" links to itself`);
    }
    if (!seen.has(slug)) {
      throw new Error(`/recursos article "${article.slug}" links to unknown slug "${slug}"`);
    }
  }
}
