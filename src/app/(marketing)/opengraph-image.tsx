import messages from "../../../messages/es.json";
import { OG_SIZE, brandCard } from "@/components/marketing/og-card";

// The brand og-image for every marketing page that doesn't override it.

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = messages.marketing.home.meta.title;

export default function OpenGraphImage() {
  return brandCard(
    "clientes.com.py",
    messages.marketing.home.hero.title,
    messages.marketing.home.hero.eyebrow,
  );
}
