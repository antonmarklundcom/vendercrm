import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSuperadminContext } from "@/modules/tenancy/context";
import { getUserById } from "@/modules/tenancy/users";
import { AppNav, type NavGroup } from "@/components/app-nav";
import { UserMenu } from "@/components/user-menu";

export default async function SuperadminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getSuperadminContext();
  if (!ctx) redirect("/login");

  const t = await getTranslations("superadmin.nav");
  const tc = await getTranslations("common");

  const user = await getUserById(ctx.userId);

  // Same shell as the tenant app: one nav component, so the console stops
  // looking like a different product from the one it administers.
  const groups: NavGroup[] = [
    {
      label: null,
      items: [
        { href: "/overview", label: t("overview"), icon: "dashboard" },
        { href: "/tenants", label: t("tenants"), icon: "contacts" },
        { href: "/platform-users", label: t("users"), icon: "users" },
        { href: "/plans", label: t("plans"), icon: "quotes" },
        { href: "/whatsapp-health", label: t("whatsappHealth"), icon: "whatsapp" },
        { href: "/claude-ops", label: t("claudeOps"), icon: "automations" },
        { href: "/audit", label: t("audit"), icon: "settings" },
      ],
    },
  ];

  const identity = {
    name: user?.name ?? "",
    email: user?.email ?? "",
    subtitle: t("superadmin"),
    signOutLabel: tc("signOut"),
  };

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <AppNav
        groups={groups}
        appName={tc("appName")}
        footer={<UserMenu {...identity} />}
        mobileHeader={<UserMenu {...identity} variant="bar" />}
      />
      <div className="min-w-0 flex-1 p-6">{children}</div>
    </div>
  );
}
