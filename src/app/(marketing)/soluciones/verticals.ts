// The five vertical sales pages (MARKETING_SITE_PLAN.md §2). The slugs double
// as the message namespaces under `marketing.soluciones`, so adding a vertical
// is one entry here plus its content block in each messages file. Order is the
// display order everywhere (home grid, footer, "other verticals" links).
export const MARKETING_VERTICALS = [
  "clinicas",
  "constructoras",
  "inmobiliarias",
  "servicios-profesionales",
  "empresas-b2b",
] as const;

export type MarketingVertical = (typeof MARKETING_VERTICALS)[number];

export function isMarketingVertical(slug: string): slug is MarketingVertical {
  return (MARKETING_VERTICALS as readonly string[]).includes(slug);
}
