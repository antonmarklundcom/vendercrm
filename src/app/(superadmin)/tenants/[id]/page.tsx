import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { buildSystemTenantContext, requireSuperadminContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import { getLatestSubscriptionForTenant } from "@/modules/tenancy/subscriptions";
import { listPlans, getPlan } from "@/modules/tenancy/plans";
import { listUsersForTenant } from "@/modules/tenancy/users";
import { listAccountsForTenant } from "@/modules/whatsapp/accounts";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { CreateUserForm, type CreateUserLabels } from "./CreateUserForm";
import { AddExistingUserForm, type AddExistingUserLabels } from "./AddExistingUserForm";
import { CreateSubscriptionForm, RecordPaymentForm } from "./SubscriptionForms";
import { configureWithAiAction, impersonateAction } from "./actions";
import { MemberEditDialog, type MemberEditLabels } from "./MemberEditDialog";
import { ResetPasswordButton, type ResetPasswordLabels } from "./ResetPasswordButton";
import { WhatsappSection } from "./WhatsappSection";

// Defense in depth (§3.3): the (superadmin) layout already redirects a
// non-superadmin, but a layout is not an authorization boundary — this page
// re-checks for itself, the same as whatsapp-health.
export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperadminContext();
  const { id } = await params;
  const tenant = await getTenant(id);
  if (!tenant) notFound();

  const [subscription, plans, users] = await Promise.all([
    getLatestSubscriptionForTenant(id),
    listPlans(),
    listUsersForTenant(id),
  ]);
  const plan = subscription ? await getPlan(subscription.planId) : null;

  // System context, not the superadmin's own — the wa_accounts read has to
  // be scoped to *this* tenant regardless of which businesses the operator
  // is a member of (§3.3).
  const tenantCtx = await buildSystemTenantContext(id);
  const waAccounts = tenantCtx ? await listAccountsForTenant(tenantCtx) : [];

  const t = await getTranslations("superadmin.tenants");
  const ts = await getTranslations("superadmin.subscriptions");
  const tu = await getTranslations("superadmin.tenantUsers");
  const tc = await getTranslations("common");

  const userLabels: CreateUserLabels = {
    name: tu("name"),
    email: tu("email"),
    password: tu("password"),
    role: tu("role"),
    roleAdmin: tu("roles.admin"),
    roleAgent: tu("roles.agent"),
    submit: tu("submit"),
    created: tu("created"),
    errors: {
      invalid: tu("errors.invalid"),
      emailTaken: tu("errors.emailTaken"),
      unknown: tu("errors.unknown"),
    },
  };

  const editLabels: MemberEditLabels = {
    trigger: tu("edit"),
    title: tu("editTitle"),
    name: tu("name"),
    email: tu("email"),
    save: tc("save"),
    cancel: tc("cancel"),
    errors: {
      invalid: tu("editErrors.invalid"),
      emailTaken: tu("editErrors.emailTaken"),
      unknown: tu("editErrors.unknown"),
    },
  };

  const resetPasswordLabels: ResetPasswordLabels = {
    trigger: tu("resetPassword"),
    linkTitle: tu("resetPasswordLinkTitle"),
    linkHelp: tu("resetPasswordLinkHelp"),
    copy: tu("copy"),
    copied: tu("copied"),
    error: tu("resetPasswordError"),
  };

  const addExistingLabels: AddExistingUserLabels = {
    email: tu("email"),
    role: tu("role"),
    roleAdmin: tu("roles.admin"),
    roleAgent: tu("roles.agent"),
    submit: tu("addExisting.submit"),
    added: tu("addExisting.added"),
    errors: {
      invalid: tu("errors.invalid"),
      userNotFound: tu("addExisting.errors.userNotFound"),
      alreadyMember: tu("addExisting.errors.alreadyMember"),
      superadminTarget: tu("addExisting.errors.superadminTarget"),
      unknown: tu("errors.unknown"),
    },
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={tenant.name} description={tenant.slug} />

      <section>
        <h2 className="mb-2 text-lg font-semibold">{ts("title")}</h2>
        {subscription ? (
          <div className="text-sm">
            <p>
              {ts("plan")}: {plan?.name ?? subscription.planId}
            </p>
            <p>
              {ts("expiresAt")}: {subscription.expiresAt.toISOString()}
            </p>
            <p>
              {ts("accessStatus")}: {subscription.status}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{ts("none")}</p>
        )}
      </section>

      {!subscription && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">{ts("createTitle")}</h2>
          <CreateSubscriptionForm
            tenantId={tenant.id}
            plans={plans.map((p) => ({ id: p.id, name: p.name }))}
          />
        </section>
      )}

      {subscription && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">{ts("recordPaymentTitle")}</h2>
          <RecordPaymentForm tenantId={tenant.id} subscriptionId={subscription.id} />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">{tu("title")}</h2>
        <p className="mb-3 max-w-2xl text-sm text-muted-foreground">{tu("intro")}</p>
        {users.length === 0 ? (
          <p className="mb-6 text-sm text-muted-foreground">{tu("noUsers")}</p>
        ) : (
          <div className="mb-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 font-medium">{tu("name")}</th>
                  <th className="py-2 font-medium">{tu("email")}</th>
                  <th className="py-2 font-medium">{tu("role")}</th>
                  <th className="py-2 font-medium">{tu("stateColumn")}</th>
                  <th className="py-2 text-right font-medium">{tu("actionsColumn")}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b align-top">
                    <td className="py-3 pr-4">{user.name}</td>
                    <td className="py-3 pr-4">{user.email}</td>
                    <td className="py-3 pr-4">
                      {user.role === "admin" ? tu("roles.admin") : tu("roles.agent")}
                    </td>
                    <td className="py-3 pr-4">
                      {user.banned ? (
                        <span className="text-muted-foreground">{tu("inactive")}</span>
                      ) : (
                        <span className="text-success">{tu("stateActive")}</span>
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap items-start justify-end gap-2">
                        <MemberEditDialog
                          tenantId={tenant.id}
                          userId={user.id}
                          name={user.name}
                          email={user.email}
                          labels={editLabels}
                        />
                        <form action={impersonateAction}>
                          <input type="hidden" name="userId" value={user.id} />
                          <input type="hidden" name="tenantId" value={tenant.id} />
                          <Button type="submit" size="sm" variant="outline">
                            {t("impersonate")}
                          </Button>
                        </form>
                        {user.role === "admin" && (
                          <form action={configureWithAiAction}>
                            <input type="hidden" name="userId" value={user.id} />
                            <input type="hidden" name="tenantId" value={tenant.id} />
                            <Button type="submit" size="sm" variant="outline">
                              {t("configureWithAi")}
                            </Button>
                          </form>
                        )}
                        <ResetPasswordButton
                          tenantId={tenant.id}
                          userId={user.id}
                          labels={resetPasswordLabels}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="mb-3 text-base font-medium">{tu("createTitle")}</h3>
        <CreateUserForm tenantId={tenant.id} labels={userLabels} />

        {/* The other door: someone who already has an account elsewhere on the
            platform gets a membership here too, keeping the access they have
            (PLAN.md §3.1, reopened). */}
        <h3 className="mt-8 mb-1 text-base font-medium">{tu("addExisting.title")}</h3>
        <p className="mb-3 max-w-2xl text-sm text-muted-foreground">
          {tu("addExisting.intro")}
        </p>
        <AddExistingUserForm tenantId={tenant.id} labels={addExistingLabels} />
      </section>

      <WhatsappSection
        tenantId={tenant.id}
        accounts={waAccounts.map((account) => ({
          id: account.id,
          wabaId: account.wabaId,
          phoneNumberId: account.phoneNumberId,
          displayNumber: account.displayNumber,
          verifiedName: account.verifiedName,
          status: account.status,
          qualityRating: account.qualityRating,
          connectedVia: account.connectedVia,
        }))}
      />
    </div>
  );
}
