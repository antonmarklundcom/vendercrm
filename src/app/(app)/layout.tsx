import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getTenantContext } from "@/modules/tenancy/context";

// Tenant suspension/expiry enforcement (PLAN.md §10 1B: "grace → read-only
// banner → locked"). Runs server-side, in the Node.js runtime, so it can
// reach the tenancy module directly (middleware.ts only does the cheap
// unauthenticated-redirect check — see its comment for why).
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  const status = ctx.accessStatus;

  if (status === "locked") {
    const t = await getTranslations("tenancy.status.locked");
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="max-w-md text-muted-foreground">{t("body")}</p>
        <a href="/login" className="text-sm underline">
          {t("backToLogin")}
        </a>
      </main>
    );
  }

  const graceBanner =
    status === "grace" ? (
      <GraceBanner />
    ) : null;

  const t = await getTranslations("app.nav");

  return (
    <div className="flex flex-1 flex-col">
      {graceBanner}
      <nav className="flex gap-4 border-b px-6 py-3 text-sm">
        <Link href="/dashboard">{t("dashboard")}</Link>
        <Link href="/contacts">{t("contacts")}</Link>
        <Link href="/pipeline">{t("pipeline")}</Link>
        {/* A client is a lead viewer, not a CRM operator: they get contacts
            and their pipeline (both site-scoped) and nothing that would let
            them work the owner's inbox, send from their number, or edit
            automations. */}
        {ctx.role !== "client" && <Link href="/inbox">{t("inbox")}</Link>}
        {ctx.role !== "client" && <Link href="/quotes">{t("quotes")}</Link>}
        {ctx.role !== "client" && <Link href="/products">{t("products")}</Link>}
        {ctx.role !== "client" && <Link href="/automations">{t("automations")}</Link>}
        {ctx.role !== "client" && <Link href="/forms">{t("forms")}</Link>}
        {ctx.role === "admin" && <Link href="/team">{t("team")}</Link>}
        {ctx.role === "admin" && <Link href="/sites">{t("sites")}</Link>}
        {ctx.role === "admin" && <Link href="/whatsapp">{t("whatsapp")}</Link>}
        {ctx.role === "admin" && <Link href="/settings">{t("settings")}</Link>}
        {/* Phase 2 (§9). Present but inert so the roadmap is visible in the
            product itself, per §8's "nav item exists, disabled". */}
        <span
          aria-disabled="true"
          title={t("facturaElectronica")}
          className="cursor-not-allowed text-muted-foreground/60"
        >
          {t("facturaElectronica")}
        </span>
      </nav>
      <div className="flex-1 p-6">{children}</div>
    </div>
  );
}

async function GraceBanner() {
  const t = await getTranslations("tenancy.status.grace");
  return (
    <div className="w-full bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
      {t("banner")}
    </div>
  );
}
