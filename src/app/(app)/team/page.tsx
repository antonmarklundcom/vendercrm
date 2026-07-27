import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listTenantUsersWithAccess } from "@/modules/access/users";
import { listSites } from "@/modules/sites/sites";
import { listInvitations } from "@/modules/tenancy/invitations";
import { Button } from "@/components/ui/button";
import { inviteUserAction, setRoleAction, setSitesAction } from "./actions";

const ROLES = ["admin", "agent", "client"] as const;

export default async function TeamPage() {
  const ctx = await requireTenantContext();

  // Hiding the nav link is not access control — a client must be refused
  // here too, or the URL alone would be enough (PLAN.md §5.2).
  if (ctx.role === "client") {
    return <p className="text-muted-foreground">{(await getTranslations("app"))("clientPortalOnly")}</p>;
  }
  const t = await getTranslations("app.team");

  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const [users, sites, invitations] = await Promise.all([
    listTenantUsersWithAccess(ctx),
    listSites(ctx),
    listInvitations(ctx),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-2 text-xl font-semibold">{t("title")}</h1>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>

        <ul className="flex flex-col gap-4">
          {users.map((user) => (
            <li key={user.id} className="flex flex-col gap-3 rounded-md border px-4 py-3">
              <div>
                <p className="font-medium">
                  {user.name}{" "}
                  <span className="text-sm text-muted-foreground">{user.email}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {user.siteIds.length === 0
                    ? t("allSites")
                    : t("nSites", { count: user.siteIds.length })}
                </p>
              </div>

              <form action={setRoleAction} className="flex items-end gap-2 text-sm">
                <input type="hidden" name="userId" value={user.id} />
                <label className="flex flex-col gap-1">
                  {t("role")}
                  <select
                    name="role"
                    defaultValue={user.role ?? "agent"}
                    className="rounded-md border px-2 py-1"
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {t(`roles.${role}` as "roles.admin")}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" size="sm" variant="outline">
                  {t("saveRole")}
                </Button>
              </form>

              {user.role !== "admin" && (
                <form action={setSitesAction} className="flex flex-col gap-2 text-sm">
                  <input type="hidden" name="userId" value={user.id} />
                  <span className="text-muted-foreground">{t("siteAccess")}</span>
                  <div className="flex flex-wrap gap-3">
                    {sites.map((site) => (
                      <label key={site.id} className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          name="siteIds"
                          value={site.id}
                          defaultChecked={user.siteIds.includes(site.id)}
                        />
                        {site.name}
                      </label>
                    ))}
                    {sites.length === 0 && (
                      <span className="text-muted-foreground">{t("noSites")}</span>
                    )}
                  </div>
                  <Button type="submit" size="sm" variant="outline" className="w-fit">
                    {t("saveSites")}
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("inviteTitle")}</h2>
        <p className="mb-3 max-w-2xl text-sm text-muted-foreground">{t("inviteHelp")}</p>
        <form action={inviteUserAction} className="flex max-w-sm flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            {t("email")}
            <input name="email" type="email" required className="rounded-md border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("role")}
            <select name="role" required className="rounded-md border px-3 py-2">
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`roles.${role}` as "roles.admin")}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">{t("invite")}</Button>
        </form>
      </section>

      {invitations.filter((i) => !i.acceptedAt).length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("pendingTitle")}</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {invitations
              .filter((i) => !i.acceptedAt)
              .map((invitation) => (
                <li key={invitation.id} className="rounded-md border px-3 py-2">
                  {invitation.email} · {t(`roles.${invitation.role}` as "roles.admin")}
                  <span className="ml-2 text-xs text-muted-foreground">
                    /accept-invite/{invitation.token}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
