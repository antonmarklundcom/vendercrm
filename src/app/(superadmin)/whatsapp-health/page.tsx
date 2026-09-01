import { getTranslations } from "next-intl/server";
import { requireSuperadminContext } from "@/modules/tenancy/context";
import {
  listAccountHealth,
  listFailedWebhookEvents,
  listDeadWhatsappJobs,
  listRecentSendFailures,
  countDeadJobsByTenant,
} from "@/modules/whatsapp/health";
import { listDeadJobs, listStuckJobs, type OpsJob } from "@/lib/queue/ops";
import { Button } from "@/components/ui/button";
import {
  retryJobAction,
  syncTemplatesAction,
  clearAccountErrorAction,
  retryTenantWhatsappJobsAction,
} from "./actions";
import { formatDateTime } from "@/lib/i18n/format";
import { graphVersionWarning } from "@/modules/whatsapp/graph";
import { getLocale } from "next-intl/server";

export default async function WhatsappHealthPage() {
  const ctx = await requireSuperadminContext();
  const t = await getTranslations("superadmin.whatsappHealth");
  const locale = await getLocale();

  const [accounts, failedEvents, deadJobs, queueDead, queueStuck, sendFailures, deadByTenant] =
    await Promise.all([
      listAccountHealth(ctx),
      listFailedWebhookEvents(ctx),
      listDeadWhatsappJobs(ctx),
      listDeadJobs(),
      listStuckJobs(),
      listRecentSendFailures(ctx),
      countDeadJobsByTenant(ctx),
    ]);

  // Meta retires Graph API versions on a schedule and a retired one simply
  // stops answering, taking every tenant's WhatsApp with it (PLAN.md §14 I2
  // #2). This page is where an operator already looks when WhatsApp misbehaves,
  // so the warning belongs above the accounts rather than in a log nobody reads.
  const versionWarning = graphVersionWarning();

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-semibold">{t("title")}</h1>
        {versionWarning && (
          <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {versionWarning.kind === "past_review"
              ? t("graphVersionPastReview", {
                  version: versionWarning.version,
                  date: versionWarning.reviewDate,
                })
              : t("graphVersionUndocumented", { version: versionWarning.version })}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4">{t("tenant")}</th>
                <th className="py-2 pr-4">{t("number")}</th>
                <th className="py-2 pr-4">{t("status")}</th>
                <th className="py-2 pr-4">{t("quality")}</th>
                <th className="py-2 pr-4">{t("connectedVia")}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-b">
                  <td className="py-2 pr-4">{account.tenantName}</td>
                  <td className="py-2 pr-4">{account.displayNumber || account.phoneNumberId}</td>
                  <td className={`py-2 pr-4 ${account.status === "error" ? "text-destructive" : ""}`}>
                    {account.status}
                  </td>
                  <td className="py-2 pr-4">{account.qualityRating ?? "—"}</td>
                  <td className="py-2 pr-4">{account.connectedVia}</td>
                  <td className="flex flex-wrap justify-end gap-2 py-2">
                    <form action={syncTemplatesAction}>
                      <input type="hidden" name="accountId" value={account.id} />
                      <Button type="submit" size="sm" variant="outline">
                        {t("syncTemplates")}
                      </Button>
                    </form>
                    {account.status === "error" && (
                      <form action={clearAccountErrorAction}>
                        <input type="hidden" name="accountId" value={account.id} />
                        <Button type="submit" size="sm" variant="outline">
                          {t("clearError")}
                        </Button>
                      </form>
                    )}
                    {(deadByTenant.get(account.tenantId) ?? 0) > 0 && (
                      <form action={retryTenantWhatsappJobsAction}>
                        <input type="hidden" name="tenantId" value={account.tenantId} />
                        <Button type="submit" size="sm" variant="outline">
                          {t("retryTenantJobs", { count: deadByTenant.get(account.tenantId) ?? 0 })}
                        </Button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-muted-foreground">
                    {t("noAccounts")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* What Meta actually said. The view could tell you an account was in
          error but never why, so diagnosing one meant asking the tenant to
          reproduce it. */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("sendFailures")}</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {sendFailures.map((failure) => (
            <li key={failure.id} className="rounded-md border px-3 py-2">
              <p className="font-medium">{failure.tenantName ?? failure.tenantId}</p>
              <p className="break-words text-muted-foreground">
                {typeof failure.error === "string"
                  ? failure.error
                  : JSON.stringify(failure.error)}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(failure.createdAt, locale)}
              </p>
            </li>
          ))}
          {sendFailures.length === 0 && (
            <li className="text-muted-foreground">{t("noSendFailures")}</li>
          )}
        </ul>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("failedWebhooks")}</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {failedEvents.map((event) => (
            <li key={event.id} className="rounded-md border px-3 py-2">
              <p className="font-medium">{event.phoneNumberId ?? "—"}</p>
              <p className="text-muted-foreground">{event.error}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(event.createdAt, locale)}
              </p>
            </li>
          ))}
          {failedEvents.length === 0 && (
            <li className="text-muted-foreground">{t("noFailures")}</li>
          )}
        </ul>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("deadJobs")}</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {deadJobs.map((job) => (
            <li key={job.id} className="rounded-md border px-3 py-2">
              <p className="font-medium">
                {job.type} <span className="text-muted-foreground">({job.attempts})</span>
              </p>
              <p className="text-muted-foreground">{job.lastError}</p>
            </li>
          ))}
          {deadJobs.length === 0 && <li className="text-muted-foreground">{t("noDeadJobs")}</li>}
        </ul>
      </section>

      {/* Platform-wide queue, not just WhatsApp: a job that dies or hangs is
          work the tenant asked for and never got, and until now nothing in
          the product showed it (PLAN.md §13 H3 #3). */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("queueDead")}</h2>
        <JobList jobs={queueDead} empty={t("noQueueDead")} retryLabel={t("retryJob")} />
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">{t("queueStuck")}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{t("queueStuckIntro")}</p>
        <JobList jobs={queueStuck} empty={t("noQueueStuck")} retryLabel={t("retryJob")} />
      </section>
    </div>
  );
}

function JobList({
  jobs,
  empty,
  retryLabel,
}: {
  jobs: OpsJob[];
  empty: string;
  retryLabel: string;
}) {
  if (jobs.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;

  return (
    <ul className="flex flex-col gap-2 text-sm">
      {jobs.map((job) => (
        <li
          key={job.id}
          className="flex flex-wrap items-start justify-between gap-3 rounded-md border px-3 py-2"
        >
          <div className="min-w-0">
            <p className="font-medium">
              {job.type}{" "}
              <span className="text-muted-foreground">
                ({job.attempts}/{job.maxAttempts})
              </span>
            </p>
            <p className="break-words text-muted-foreground">{job.lastError ?? "—"}</p>
            <p className="text-xs text-muted-foreground">
              {(job.lockedAt ?? job.runAt).toLocaleString("es-PY")}
              {job.tenantId ? ` · ${job.tenantId}` : ""}
            </p>
          </div>
          <form action={retryJobAction}>
            <input type="hidden" name="jobId" value={job.id} />
            <Button type="submit" size="sm" variant="outline">
              {retryLabel}
            </Button>
          </form>
        </li>
      ))}
    </ul>
  );
}
