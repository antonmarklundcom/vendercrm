import { getTranslations, getLocale } from "next-intl/server";
import { requireSuperadminContext } from "@/modules/tenancy/context";
import { PageHeader } from "@/components/page-header";
import { listOpsTokens, type OpsRowState } from "@/modules/ops";
import { OpsLog } from "@/components/ops/OpsLog";
import { TokenPanel, type TokenPanelLabels } from "./TokenPanel";
import { BatchBar, type BatchBarLabels } from "./BatchBar";
import { Worksheet, type WorksheetLabels } from "./Worksheet";
import { NeedsYou, type NeedsYouLabels } from "./NeedsYou";
import {
  getBatchRowViews,
  listNeedsYouViews,
  listOpsAuditEntries,
  listOpsBatchesForConsole,
} from "./queries";

// The control tower for Claude Ops (PLAN.md §18.4): a session provisions
// through the API, this page is where the owner watches it and approves
// each site before it goes live. Defense in depth (§3.3): the layout
// already redirects a non-superadmin, this page re-checks for itself.
export default async function ClaudeOpsPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string; log?: string }>;
}) {
  await requireSuperadminContext();
  const { batch: batchParam, log: logParam } = await searchParams;

  const t = await getTranslations("superadmin.ops");
  const locale = await getLocale();

  const [tokens, batches] = await Promise.all([listOpsTokens(), listOpsBatchesForConsole()]);

  const stateLabels: Record<OpsRowState, string> = {
    pending: t("states.pending"),
    running: t("states.running"),
    needs_input: t("states.needsInput"),
    failed: t("states.failed"),
    awaiting_approval: t("states.awaitingApproval"),
    live: t("states.live"),
  };

  const tokenLabels: TokenPanelLabels = {
    title: t("token.title"),
    createLabel: t("token.createLabel"),
    createPlaceholder: t("token.createPlaceholder"),
    createSubmit: t("token.createSubmit"),
    revealTitle: t("token.revealTitle"),
    revealHint: t("token.revealHint"),
    copy: t("token.copy"),
    copied: t("token.copied"),
    prefix: t("token.prefix"),
    lastUsed: t("token.lastUsed"),
    calls: t("token.calls"),
    never: t("token.never"),
    allowlist: t("token.allowlist"),
    allowlistNone: t("token.allowlistNone"),
    revoke: t("token.revoke"),
    revoked: t("token.revoked"),
    errorInvalid: t("token.errorInvalid"),
    noneYet: t("token.noneYet"),
  };

  if (tokens.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} description={t("intro")} />
        <p className="max-w-2xl text-sm text-muted-foreground">{t("noTokenIntro")}</p>
        <TokenPanel tokens={tokens} labels={tokenLabels} locale={locale} />
      </div>
    );
  }

  const activeBatchId = batchParam ?? batches[0]?.id ?? null;
  const activeBatch = activeBatchId ? (batches.find((b) => b.id === activeBatchId) ?? null) : null;
  const rows = activeBatchId ? await getBatchRowViews(activeBatchId) : [];

  const [needsYou, logEntries] = await Promise.all([listNeedsYouViews(), listOpsAuditEntries()]);

  const logFilter =
    logParam === "failures" || logParam === "all" ? logParam : ("batch" as const);

  const batchBarLabels: BatchBarLabels = {
    select: t("batch.select"),
    newBatch: t("batch.newBatch"),
    newBatchPlaceholder: t("batch.newBatchPlaceholder"),
    newBatchSubmit: t("batch.newBatchSubmit"),
    cancel: t("common.cancel"),
    states: stateLabels,
    noBatches: t("batch.noBatches"),
  };

  const worksheetLabels: WorksheetLabels = {
    tabSites: t("worksheet.tabSites"),
    tabPaste: t("worksheet.tabPaste"),
    colDomain: t("worksheet.colDomain"),
    colCompany: t("worksheet.colCompany"),
    colPipeline: t("worksheet.colPipeline"),
    colSteps: t("worksheet.colSteps"),
    colState: t("worksheet.colState"),
    states: stateLabels,
    openSite: t("worksheet.openSite"),
    review: t("worksheet.review"),
    emptyRows: t("worksheet.emptyRows"),
    provisioned: t("worksheet.provisioned"),
    credentials: t("worksheet.credentials"),
    rawDetails: t("worksheet.rawDetails"),
    gateNote: t("worksheet.gateNote"),
    approve: t("worksheet.approve"),
    reject: t("worksheet.reject"),
    rejectPlaceholder: t("worksheet.rejectPlaceholder"),
    rejectSubmit: t("worksheet.rejectSubmit"),
    cancel: t("common.cancel"),
    newTenant: t("worksheet.newTenant"),
    intakeHint: t("worksheet.intakeHint"),
    intakeSave: t("worksheet.intakeSave"),
    intakePlaceholder: t("worksheet.intakePlaceholder"),
  };

  const needsYouLabels: NeedsYouLabels = {
    title: t("needsYou.title"),
    empty: t("needsYou.empty"),
    awaitingApproval: t("states.awaitingApproval"),
    needsInput: t("states.needsInput"),
    failed: t("states.failed"),
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("intro")} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <BatchBar
            batches={batches}
            activeBatchId={activeBatchId}
            rows={rows}
            labels={batchBarLabels}
          />

          {activeBatch ? (
            <Worksheet
              batch={{ id: activeBatch.id, rawText: activeBatch.rawText }}
              rows={rows}
              labels={worksheetLabels}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("batch.pickOne")}</p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <TokenPanel tokens={tokens} labels={tokenLabels} locale={locale} />
          <NeedsYou rows={needsYou} labels={needsYouLabels} />
        </div>
      </div>

      <OpsLog
        entries={logEntries}
        batchId={activeBatchId}
        filter={logFilter}
        locale={locale}
        labels={{
          title: t("log.title"),
          when: t("log.when"),
          action: t("log.action"),
          object: t("log.object"),
          via: t("log.via"),
          empty: t("log.empty"),
          filterBatch: t("log.filterBatch"),
          filterFailures: t("log.filterFailures"),
          filterAll: t("log.filterAll"),
          openFull: t("log.openFull"),
        }}
      />
    </div>
  );
}
