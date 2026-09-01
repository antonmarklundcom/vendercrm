import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config/hosts";

// One Node app answers both hosts (middleware.ts), so this file has to
// speak for both: the marketing site wants to be indexed, and the CRM host
// wants nothing crawled at all — every URL under it is either a login wall
// or an unguessable customer link (PLAN.md §13 H7).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Customer-facing token links and the API are not search results.
        disallow: ["/api/", "/q/", "/d/", "/f/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
