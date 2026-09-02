import messages from "../../../../../messages/es.json";
import { OG_SIZE, brandCard } from "@/components/marketing/og-card";
import { getArticle } from "@/content/recursos";

// Per-article og-image, same brand card as the vertical pages: an article
// link shared in a WhatsApp group is the most common way these get read, and
// the preview card is what decides whether it gets opened at all.

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "clientes.com.py";

export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);

  return brandCard(
    `clientes.com.py · ${messages.marketing.recursos.breadcrumb}`,
    article?.title ?? messages.marketing.recursos.header.title,
    article?.eyebrow ?? messages.marketing.recursos.header.eyebrow,
  );
}
