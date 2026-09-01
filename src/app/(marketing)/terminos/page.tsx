import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalPage } from "@/components/marketing/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.legal.terminos.meta");
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: "/terminos" },
  };
}

export default function TerminosPage() {
  return <LegalPage namespace="terminos" />;
}
