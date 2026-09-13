import { getTranslations } from "next-intl/server";
import type { SiteHealthRow } from "@/modules/sites/health";
import { ingestReasonKey, siteHealthStatus } from "@/modules/sites/health";
import { CodeBlock } from "./SiteGuide";

// Per-site connection card + troubleshooting (PLAN.md §5.2 follow-up).
//
// The connection guide further down the page explains how to wire a site
// the first time. This block answers the question that comes *after* that:
// "I pasted the code, submitted the form, nothing showed up — now what?"
// It reads the same health row the status badge does and turns it into the
// next thing to check, in order, plus a curl command that proves the CRM
// side from a terminal so the owner can tell whose half is broken.

const REASON_FIX_KEYS = [
  "invalid-key",
  "revoked-key",
  "site-inactive",
  "tenant-unavailable",
  "tenant-read-only",
  "rate-limited",
  "turnstile-failed",
  "invalid-body",
  "phone-missing",
  "unknown",
] as const;

export async function SiteDiagnostics({
  site,
  health,
  appUrl,
  hasStage,
}: {
  site: { id: string; slug: string; isActive: boolean };
  health: SiteHealthRow | null;
  appUrl: string;
  hasStage: boolean;
}) {
  const t = await getTranslations("app.sites.diagnostics");
  const endpoint = `${appUrl}/api/v1/leads`;
  const status = siteHealthStatus(health);
  const reason = ingestReasonKey(health?.lastErrorReason);

  const curl = [
    `curl -i -X POST ${endpoint} \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "X-Api-Key: vc_live_PEGA_TU_CLAVE_ACA" \\`,
    `  -d '{"phone":"0981 123 456","name":"Prueba ${site.slug}","idempotency_key":"test-${site.slug}-${Date.now()}"}'`,
  ].join("\n");

  let stepKeys: readonly string[];
  if (status === "idle") {
    stepKeys = ["idle1", "idle2", "idle3", "idle4"] as const;
  } else if (status === "failing") {
    stepKeys = [];
  } else {
    stepKeys = ["ok1"] as const;
  }

  return (
    <details className="rounded-md border bg-muted/30 px-3 py-2 text-sm" open={status !== "ok"}>
      <summary className="cursor-pointer font-medium">
        {t("title")}
        <span className="text-muted-foreground"> — {t(`summary.${status}`)}</span>
      </summary>

      <div className="mt-3 flex flex-col gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">{t("endpoint")}</dt>
          <dd>
            <code className="break-all font-mono text-xs">POST {endpoint}</code>
          </dd>
          <dt className="text-muted-foreground">{t("headers")}</dt>
          <dd>
            <code className="font-mono text-xs">X-Api-Key: vc_live_…</code>
            {" · "}
            <code className="font-mono text-xs">Content-Type: application/json</code>
          </dd>
          <dt className="text-muted-foreground">{t("required")}</dt>
          <dd>
            <code className="font-mono text-xs">phone</code>, <code className="font-mono text-xs">idempotency_key</code>
            <span className="text-muted-foreground"> — {t("requiredNote")}</span>
          </dd>
        </dl>

        <div>
          <p className="font-medium">{t("checkTitle")}</p>
          {status === "failing" && (
            <p className="mt-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              {t(`fixes.${REASON_FIX_KEYS.includes(reason) ? reason : "unknown"}`)}
            </p>
          )}
          {!site.isActive && status !== "failing" && (
            <p className="mt-1 rounded-md border border-warning/30 bg-warning-surface px-3 py-2 text-warning">
              {t("fixes.site-inactive")}
            </p>
          )}
          {stepKeys.length > 0 && (
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {stepKeys.map((key) => (
                <li key={key}>{t(`steps.${key}`)}</li>
              ))}
            </ol>
          )}
          {status === "ok" && !hasStage && (
            <p className="mt-1 text-muted-foreground">{t("noStageHint")}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <p className="font-medium">{t("testTitle")}</p>
          <p className="text-muted-foreground">{t("testBody")}</p>
          <CodeBlock code={curl} copy={t("copy")} copied={t("copied")} />
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t("expect.201")}</li>
            <li>{t("expect.401")}</li>
            <li>{t("expect.422")}</li>
            <li>{t("expect.none")}</li>
          </ul>
        </div>
      </div>
    </details>
  );
}
