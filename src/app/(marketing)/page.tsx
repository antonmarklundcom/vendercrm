import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/server";
import { Hero } from "@/components/marketing/hero";
import { TrustRibbon } from "@/components/marketing/trust-ribbon";
import { ProblemSection } from "@/components/marketing/problem-section";
import { ServicesSection, type ServiceItem } from "@/components/marketing/services-section";
import { MethodRail, type MethodStep } from "@/components/marketing/method-steps";
import { VerticalCards, type VerticalItem } from "@/components/marketing/vertical-cards";
import { Statement } from "@/components/marketing/statement";
import { CtaBand } from "@/components/marketing/cta-band";
import { contact } from "@/lib/site-config";
import { MARKETING_VERTICALS } from "./soluciones/verticals";

// Same Node app answers both the apex marketing domain and the crm.*
// subdomain (parked domain, shared document root — see hPanel Domains).
// Only the crm.* host runs the CRM itself; every other host (apex, www.,
// Hostinger's own preview hostname) gets the marketing homepage. The host
// check lives here rather than in a separate src/app/page.tsx because a
// route group and the app root cannot both own "/".
const APP_HOST_PREFIX = "crm.";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.home.meta");
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: "/" },
  };
}

export default async function Home() {
  const host = (await headers()).get("host") ?? "";

  if (host.startsWith(APP_HOST_PREFIX)) {
    // "/" carries no session guard of its own — (app)/layout.tsx and
    // (superadmin)/layout.tsx each redirect to /login when unauthenticated,
    // but only once you're already inside one of those route groups. Route
    // straight to the right area (or /login) instead of showing the
    // marketing homepage on the CRM host.
    const session = await auth.api.getSession({ headers: await headers() });
    const user = session?.user as { isSuperadmin?: boolean | null } | undefined;

    if (!user) redirect("/login");
    redirect(user.isSuperadmin ? "/tenants" : "/dashboard");
  }

  const t = await getTranslations("marketing");
  const cta = {
    primaryLabel: t("cta.primary"),
    whatsappLabel: t("cta.whatsapp"),
    whatsappPrefill: t("cta.waPrefill"),
  };

  // Section → pattern map (web-design-system step 2), no two consecutive
  // sections sharing a pattern:
  //   hero P1 · ribbon P8 · problem P4 · services hairline rail
  //   method P5 · verticals P3 · statement P9 · closing overlap + ink band
  return (
    <>
      <Hero
        eyebrow={t("home.hero.eyebrow")}
        title={t("home.hero.title")}
        lead={t("home.hero.lead")}
        body={t("home.hero.body")}
        points={t.raw("home.hero.points") as string[]}
        asideTitle={t("home.hero.asideTitle")}
        asideBody={t("home.hero.asideBody")}
        asideNote={t("home.hero.asideNote")}
        cta={cta}
      />

      <TrustRibbon
        items={[
          t("ribbon.monthly"),
          t("ribbon.measured"),
          t("ribbon.ownData"),
          // Only once the owner has supplied it (site-config TODO).
          ...(contact.ruc ? [t("ribbon.ruc", { ruc: contact.ruc })] : []),
        ]}
      />

      <ProblemSection
        eyebrow={t("home.problem.eyebrow")}
        title={t("home.problem.title")}
        body={t("home.problem.body")}
        bodyTwo={t("home.problem.bodyTwo")}
        symptomsTitle={t("home.problem.symptomsTitle")}
        symptoms={t.raw("home.problem.symptoms") as string[]}
      />

      <ServicesSection
        eyebrow={t("home.services.eyebrow")}
        title={t("home.services.title")}
        lead={t("home.services.lead")}
        items={t.raw("home.services.items") as ServiceItem[]}
        fineprint={t("home.services.fineprint")}
      />

      <MethodRail
        eyebrow={t("home.method.eyebrow")}
        title={t("home.method.title")}
        lead={t("home.method.lead")}
        steps={t.raw("home.method.steps") as MethodStep[]}
        link={{ href: "/metodo", label: t("home.method.linkLabel") }}
      />

      <VerticalCards
        eyebrow={t("home.verticals.eyebrow")}
        title={t("home.verticals.title")}
        lead={t("home.verticals.lead")}
        items={(t.raw("home.verticals.items") as VerticalItem[]).map(
          // The copy list and the slug list share their order; zipping them
          // here keeps the card copy in messages/ and the routing in code.
          (item, index) => ({
            ...item,
            href: MARKETING_VERTICALS[index]
              ? `/soluciones/${MARKETING_VERTICALS[index]}`
              : undefined,
          }),
        )}
      />

      <Statement text={t("home.statement.text")} sub={t("home.statement.sub")} />

      <CtaBand
        eyebrow={t("home.closing.eyebrow")}
        title={t("home.closing.title")}
        body={t("home.closing.body")}
        panelTitle={t("home.closing.panelTitle")}
        panelItems={t.raw("home.closing.panelItems") as string[]}
        cta={cta}
      />
    </>
  );
}
