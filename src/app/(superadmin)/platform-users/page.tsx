import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { requireSuperadminContext } from "@/modules/tenancy/context";
import { listPlatformUsers, PLATFORM_USER_PAGE_SIZE } from "@/modules/tenancy/platform-users";
import { listTenants } from "@/modules/tenancy/tenants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-fields";
import { PageHeader } from "@/components/page-header";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import { UserMemberships } from "./UserMemberships";
import { MergeUserDialog, type MergeUserLabels } from "./MergeUserDialog";

// Everyone on the platform, and which businesses each one can reach. The
// console could already add a person to a business from the business's own
// page; this is the same relationship read from the other end, which is the
// end the operator actually thinks from when one person runs several
// businesses (PLAN.md §3.1).
//
// The path is /platform-users, not /users: the tenant app already owns
// /users for a business's own team, and two route groups cannot resolve the
// same path.
//
// Defense in depth (§3.3): the layout redirects a non-superadmin, but a
// layout is not an authorization boundary — this page re-checks for itself.
export default async function PlatformUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSuperadminContext();
  const { q } = await searchParams;
  const t = await getTranslations("superadmin.users");
  const tRoles = await getTranslations("app.users.roles");
  const locale = await getLocale();

  const [people, tenants] = await Promise.all([
    listPlatformUsers({ search: q }),
    listTenants(),
  ]);

  const roleLabels = { admin: tRoles("admin"), agent: tRoles("agent") };
  const tenantOptions = tenants.map((tenant) => ({ id: tenant.id, name: tenant.name }));
  const mergeLabels: MergeUserLabels = {
    trigger: t("merge.trigger"),
    title: t("merge.title"),
    body: t("merge.body"),
    targetEmail: t("merge.targetEmail"),
    submit: t("merge.submit"),
    cancel: t("merge.cancel"),
    close: t("merge.close"),
    success: t("merge.success"),
    errors: {
      invalid: t("merge.errors.invalid"),
      notFound: t("merge.errors.notFound"),
      targetNotFound: t("merge.errors.targetNotFound"),
      same: t("merge.errors.same"),
      superadmin: t("merge.errors.superadmin"),
    },
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("title")} description={t("intro")} />

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("searchLabel")}
          <Input name="q" defaultValue={q ?? ""} placeholder={t("searchPlaceholder")} />
        </label>
        <Button type="submit" variant="outline" size="sm">
          {t("search")}
        </Button>
        {q && (
          <Link href="/platform-users" className="text-sm underline underline-offset-4">
            {t("clear")}
          </Link>
        )}
      </form>

      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noResults")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 font-medium">{t("person")}</th>
                <th className="py-2 font-medium">{t("businesses")}</th>
                <th className="py-2 text-right font-medium">{t("businessCount")}</th>
                <th className="py-2 font-medium">{t("lastLogin")}</th>
                <th className="py-2 font-medium">{t("created")}</th>
                <th className="py-2 text-right font-medium">{t("actionsColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id} className="border-b align-top">
                  <td className="py-3 pr-4">
                    <span className="block font-medium">{person.name}</span>
                    <span className="block text-xs text-muted-foreground">{person.email}</span>
                    {person.isSuperadmin && (
                      <span className="mt-1 inline-block rounded-full bg-info-surface px-2 py-0.5 text-[10px] text-info">
                        {t("superadminBadge")}
                      </span>
                    )}
                    {person.banned && (
                      <span className="mt-1 ml-1 inline-block rounded-full bg-destructive-surface px-2 py-0.5 text-[10px] text-destructive">
                        {t("platformBanned")}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    {person.isSuperadmin ? (
                      // A superadmin reaches every business through
                      // impersonation, so a membership picker here would offer
                      // a grant that must not exist (see actions.ts).
                      <span className="text-sm text-muted-foreground">{t("superadminReach")}</span>
                    ) : (
                      <UserMemberships
                        userId={person.id}
                        memberships={person.memberships.map((membership) => ({
                          tenantId: membership.tenantId,
                          tenantName: membership.tenantName,
                          role: membership.role,
                          banned: membership.banned,
                        }))}
                        tenants={tenantOptions}
                        roleLabels={roleLabels}
                      />
                    )}
                  </td>
                  <td className="py-3 text-right text-xs tabular-nums text-muted-foreground">
                    {person.businessCount}
                  </td>
                  <td className="py-3 text-xs whitespace-nowrap text-muted-foreground">
                    {person.lastLoginAt ? formatDateTime(person.lastLoginAt, locale) : t("neverLoggedIn")}
                  </td>
                  <td className="py-3 text-xs whitespace-nowrap text-muted-foreground">
                    {formatDate(person.createdAt, locale)}
                  </td>
                  <td className="py-3 text-right">
                    {!person.isSuperadmin && (
                      <MergeUserDialog
                        sourceUserId={person.id}
                        sourceEmail={person.email}
                        labels={mergeLabels}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {people.length === PLATFORM_USER_PAGE_SIZE && (
        <p className="text-sm text-muted-foreground">
          {t("truncated", { count: PLATFORM_USER_PAGE_SIZE })}
        </p>
      )}
    </div>
  );
}
