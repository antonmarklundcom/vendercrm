import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSuperadminPage } from "@/modules/tenancy/guard";
import { signOutAction } from "@/modules/auth/actions";
import { Button } from "@/components/ui/button";

export default async function SuperadminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSuperadminPage();
  const t = await getTranslations("superadmin");
  const tc = await getTranslations("auth");

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-3">
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/superadmin" className="font-semibold">
              {t("title")}
            </Link>
            <Link href="/superadmin" className="text-muted-foreground hover:text-foreground">
              {t("tenants")}
            </Link>
            <Link href="/superadmin/plans" className="text-muted-foreground hover:text-foreground">
              {t("plans")}
            </Link>
          </nav>
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm">
              {tc("logout")}
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
