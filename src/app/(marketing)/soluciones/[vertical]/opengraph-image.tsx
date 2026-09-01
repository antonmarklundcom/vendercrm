import messages from "../../../../../messages/es.json";
import { OG_SIZE, brandCard } from "@/components/marketing/og-card";
import { isMarketingVertical } from "../verticals";

// Per-vertical og-image: the shared brand card with the vertical's own
// headline, so a page link shared in WhatsApp names the rubro before it is
// even opened. Reads es.json directly — og cards are Spanish like the site.

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "clientes.com.py";

export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ vertical: string }>;
}) {
  const { vertical } = await params;
  const soluciones = messages.marketing.soluciones;
  const content = isMarketingVertical(vertical)
    ? soluciones[vertical]
    : null;

  return brandCard(
    `clientes.com.py · ${soluciones.common.breadcrumbSection}`,
    content?.header.title ?? messages.marketing.home.hero.title,
    content?.name ?? messages.marketing.home.hero.eyebrow,
  );
}
