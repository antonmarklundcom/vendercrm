import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getTenantContext } from "@/modules/tenancy/context";
import { getUserById } from "@/modules/tenancy/users";
import { resolveTheme } from "@/lib/theme-resolve";
import { listMembershipsForUser } from "@/modules/tenancy/memberships";
import { getTenant } from "@/modules/tenancy/tenants";
import { AppNav, type NavGroup } from "@/components/app-nav";
import { UserMenu } from "@/components/user-menu";
import { BusinessSwitcher, type SwitchableBusiness } from "@/components/business-switcher";
import { Toaster } from "@/components/ui/sonner";
import { CommandPalette } from "@/components/command-palette";
import { Button } from "@/components/ui/button";
import { stopImpersonationAction } from "./actions";

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

  const impersonationBanner = ctx.impersonatorUserId ? <ImpersonationBanner /> : null;

  const graceBanner =
    status === "grace" ? (
      <GraceBanner />
    ) : null;

  const t = await getTranslations("app.nav");
  const tc = await getTranslations("common");
  const tSearch = await getTranslations("app.search");
  const tRoles = await getTranslations("app.users.roles");
  const tBusiness = await getTranslations("app.business");
  const tTheme = await getTranslations("app.settings.theme");
  const isAdmin = ctx.role === "admin";

  // "system" has no server-side answer (the OS preference is client-only) —
  // the quick toggle in UserMenu needs a concrete side to render, same
  // simplification themeClass() already makes for the <html> class.
  const resolvedTheme = await resolveTheme();
  const toggleTheme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";

  const [user, tenant, memberships] = await Promise.all([
    getUserById(ctx.userId),
    getTenant(ctx.tenantId),
    // Every business this person may act in (PLAN.md §3.1). Almost always one
    // row, in which case the switcher renders nothing.
    listMembershipsForUser(ctx.userId),
  ]);

  const businesses: SwitchableBusiness[] = memberships.map(({ membership, tenant: t }) => ({
    id: t.id,
    name: t.name,
    role: tRoles(membership.role),
  }));

  // Grouped so the nav reads as a product rather than a list of routes: what
  // you work in daily, what feeds it, and what you configure once.
  const groups: NavGroup[] = [
    {
      label: null,
      items: [{ href: "/dashboard", label: t("dashboard"), icon: "dashboard" }],
    },
    {
      label: t("groups.crm"),
      items: [
        { href: "/contacts", label: t("contacts"), icon: "contacts" },
        { href: "/pipeline", label: t("pipeline"), icon: "pipeline" },
        { href: "/inbox", label: t("inbox"), icon: "inbox" },
        // A surface of its own rather than a tab inside /inbox: the WhatsApp
        // inbox has its own assignment and 24h-window rules, and a unified
        // inbox is a decision that deserves to be made on purpose.
        { href: "/chat", label: t("chat"), icon: "chat" },
        { href: "/calendar", label: t("calendar"), icon: "calendar" },
        { href: "/quotes", label: t("quotes"), icon: "quotes" },
        { href: "/documents", label: t("documents"), icon: "documents" },
        { href: "/products", label: t("products"), icon: "products" },
        { href: "/reports", label: t("reports"), icon: "reports" },
      ],
    },
    {
      // Everything under "capture" is tenant configuration reserved for
      // `admin` (§3.2) — the actions behind these pages now require it, and
      // hiding the nav entries keeps an agent from walking into a page whose
      // every button throws. The whole group disappears for an agent, so it
      // is dropped below rather than rendered as a bare heading.
      label: t("groups.capture"),
      items: isAdmin
        ? [
            { href: "/automations", label: t("automations"), icon: "automations" as const },
            { href: "/forms", label: t("forms"), icon: "forms" as const },
            { href: "/sites", label: t("sites"), icon: "sites" as const },
            { href: "/booking", label: t("booking"), icon: "booking" as const },
            // The rubro wizard sits next to booking because that is what it
            // configures (plan-booking.md §6.1).
            { href: "/onboarding", label: t("onboarding"), icon: "booking" as const },
          ]
        : [],
    },
    {
      label: t("groups.settings"),
      items: [
        ...(isAdmin
          ? [
              { href: "/whatsapp", label: t("whatsapp"), icon: "whatsapp" as const },
              { href: "/users", label: t("users"), icon: "users" as const },
              { href: "/settings", label: t("settings"), icon: "settings" as const },
            ]
          : []),
        // Phase 2 (§9). Present but inert so the roadmap is visible in the
        // product itself, per §8's "nav item exists, disabled".
        {
          href: "/factura-electronica",
          label: t("facturaElectronica"),
          icon: "facturaElectronica" as const,
          disabled: true,
          badge: t("soon"),
        },
      ],
    },
  ];

  const visibleGroups = groups.filter((group) => group.items.length > 0);

  const identity = {
    name: user?.name ?? "",
    email: user?.email ?? "",
    subtitle: [tenant?.name, tRoles(ctx.role)].filter(Boolean).join(" · "),
    signOutLabel: tc("signOut"),
    theme: toggleTheme,
    themeToggleLabel: tTheme("toggle"),
  };

  return (
    <div className="flex flex-1 flex-col">
      {impersonationBanner}
      {graceBanner}
      <div className="flex flex-1 flex-col md:flex-row">
        <AppNav
          groups={visibleGroups}
          appName={tc("appName")}
          header={
            <BusinessSwitcher
              businesses={businesses}
              activeId={ctx.tenantId}
              labels={{
                title: tBusiness("switcherTitle"),
                current: tBusiness("switcherCurrent"),
              }}
            />
          }
          footer={<UserMenu {...identity} />}
          mobileHeader={<UserMenu {...identity} variant="bar" />}
        />
        <div className="min-w-0 flex-1 p-6">{children}</div>
      </div>
      {/* ⌘K from anywhere in the app (PLAN.md §13 H8). */}
      <CommandPalette
        labels={{
          placeholder: tSearch("placeholder"),
          empty: tSearch("empty"),
          hint: tSearch("hint"),
          kinds: {
            contact: tSearch("kinds.contact"),
            deal: tSearch("kinds.deal"),
            quote: tSearch("kinds.quote"),
            document: tSearch("kinds.document"),
            conversation: tSearch("kinds.conversation"),
          },
        }}
      />
      <Toaster />
    </div>
  );
}

// Persistent, not dismissible: a superadmin acting as someone else must be
// able to tell at any moment that what they are looking at is not their own
// account, and get out in one click.
async function ImpersonationBanner() {
  const t = await getTranslations("tenancy.impersonation");
  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-3 bg-info-surface px-4 py-2 text-center text-sm text-info">
      <span>{t("banner")}</span>
      <form action={stopImpersonationAction}>
        <Button type="submit" size="sm" variant="outline">
          {t("exit")}
        </Button>
      </form>
    </div>
  );
}

async function GraceBanner() {
  const t = await getTranslations("tenancy.status.grace");
  return (
    <div className="w-full bg-warning-surface px-4 py-2 text-center text-sm text-warning">
      {t("banner")}
    </div>
  );
}
