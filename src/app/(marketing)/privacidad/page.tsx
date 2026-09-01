import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalPage } from "@/components/marketing/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.legal.privacidad.meta");
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: "/privacidad" },
  };
}

export default function PrivacidadPage() {
  return <LegalPage namespace="privacidad" />;
}
