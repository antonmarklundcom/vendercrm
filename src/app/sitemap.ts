import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config/hosts";
import { MARKETING_VERTICALS } from "./(marketing)/soluciones/verticals";

// The marketing site is a handful of static pages, so the sitemap is a
// literal list rather than a crawl (PLAN.md §13 H7). App routes are
// deliberately absent: they are behind a login. The vertical pages are the
// money pages, so they carry the same priority as the core pages.
const PAGES = ["", "/metodo", "/nosotros", "/contacto"] as const;
const LEGAL = ["/privacidad", "/terminos"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...PAGES.map((path) => ({
      url: `${SITE_URL}${path}`,
      changeFrequency: "monthly" as const,
      priority: path === "" ? 1 : 0.8,
    })),
    ...MARKETING_VERTICALS.map((vertical) => ({
      url: `${SITE_URL}/soluciones/${vertical}`,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...LEGAL.map((path) => ({
      url: `${SITE_URL}${path}`,
      changeFrequency: "yearly" as const,
      priority: 0.2,
    })),
  ];
}
