import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantPage } from "@/modules/tenancy/guard";
import { getTenantAccess } from "@/modules/tenancy/access";
import { getSessionContext } from "@/modules/tenancy/context";
import { signOutAction, stopImpersonatingAction } from "@/modules/auth/actions";
import { Button } from "@/components/ui/button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireTenantPage();
  const t = await getTranslations("app");
  const tc = await getTranslations("auth");
  const access = await getTenantAccess(ctx.tenantId);
  const session = await getSessionContext();
  const impersonating = !!session?.impersonatorUserId;

  // Locked states replace the app entirely (PLAN.md §1B).
  if (access.state === "suspended" || access.state === "expired") {
    const title = access.state === "suspended" ? t("suspendedTitle") : t("lockedTitle");
    const body = access.state === "suspended" ? t("suspendedBody") : t("lockedBody");
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="max-w-md text-muted-foreground">{body}</p>
        <form action={impersonating ? stopImpersonatingAction : signOutAction}>
          <Button type="submit" variant="outline">
            {tc("logout")}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      {impersonating && (
        <div className="bg-amber-500/15 px-6 py-2 text-center text-sm">
          <form action={stopImpersonatingAction} className="inline">
            <button type="submit" className="underline underline-offset-2">
              ← {tc("logout")} (impersonación)
            </button>
          </form>
        </div>
      )}
      {access.state === "grace" && (
        <div className="bg-destructive/10 px-6 py-2 text-center text-sm text-destructive">
          {t("readonlyBanner")}
        </div>
      )}
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-3">
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/app" className="font-semibold">
              {t("dashboard")}
            </Link>
            <Link href="/app/contacts" className="text-muted-foreground hover:text-foreground">
              {t("contacts")}
            </Link>
            <Link href="/app/pipeline" className="text-muted-foreground hover:text-foreground">
              {t("pipeline")}
            </Link>
            <Link href="/app/inbox" className="text-muted-foreground hover:text-foreground">
              {t("inbox")}
            </Link>
            <Link href="/app/forms" className="text-muted-foreground hover:text-foreground">
              {t("forms")}
            </Link>
            {ctx.role === "admin" && (
              <Link href="/app/settings" className="text-muted-foreground hover:text-foreground">
                {t("settings")}
              </Link>
            )}
          </nav>
          {!impersonating && (
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm">
                {tc("logout")}
              </Button>
            </form>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
