import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { VERTICAL_PRESETS, stageName, type VerticalPreset } from "@/modules/tenancy/verticals";
import { listBookingTypes } from "@/modules/booking/types";
import { env } from "@/lib/config/env";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getDraftSetupPlan } from "@/modules/setup/plan";
import { SETUP_TOPICS, isConversationComplete, type SetupConversationState } from "@/modules/setup/conversation";
import {
  applySetupPlanAction,
  applyVerticalAction,
  discardSetupPlanAction,
  retrySetupPlanAction,
  submitSetupAnswerAction,
} from "./actions";

// Pick a rubro, see what it will create, apply it (plan-booking.md §6.1).
// The setup assistant (K2, PLAN.md §16.5) is now the default entry point;
// the picker below stays as "elegir un rubro sin el asistente" per step 1.
//
// One screen rather than a client-side wizard: every action re-renders this
// server component, which reads the draft plan and conversation step fresh —
// a reload always resumes exactly where the admin left off (step 2).

function PresetPreview({
  preset,
  t,
}: {
  preset: VerticalPreset;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <dl className="flex flex-col gap-1 text-sm">
      {preset.bookingTypes.length > 0 && (
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t("previewServices")}</dt>
          <dd>
            {preset.bookingTypes
              .map((type) =>
                type.capacity && type.capacity > 1
                  ? `${type.name} (${t("previewCapacity", { count: type.capacity })})`
                  : `${type.name} · ${type.durationMinutes} min`,
              )
              .join(" · ")}
          </dd>
        </div>
      )}
      {preset.resources.length > 0 && (
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t("previewResources")}</dt>
          <dd>{preset.resources.join(", ")}</dd>
        </div>
      )}
      <div className="flex gap-2">
        <dt className="text-muted-foreground">{t("previewStages")}</dt>
        <dd>{preset.pipelineStages.map(stageName).join(" → ")}</dd>
      </div>
      {preset.flows.length > 0 && (
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t("previewFlows")}</dt>
          <dd>{preset.flows.map((flow) => flow.name).join(" · ")}</dd>
        </div>
      )}
      {preset.quickReplies && preset.quickReplies.length > 0 && (
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t("assistant.previewQuickReplies")}</dt>
          <dd>{preset.quickReplies.map((reply) => reply.name).join(" · ")}</dd>
        </div>
      )}
    </dl>
  );
}

export default async function OnboardingPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.onboarding");

  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const [tenant, types] = await Promise.all([getTenant(ctx.tenantId), listBookingTypes(ctx)]);
  const settings = (tenant?.settings ?? {}) as TenantSettings;
  const applied = VERTICAL_PRESETS.find((preset) => preset.slug === settings.vertical);
  const firstType = types.find((type) => type.isActive);

  const draft = applied ? null : await getDraftSetupPlan(ctx);
  const conversation = (draft?.conversation as SetupConversationState | undefined) ?? null;
  const preset = (draft?.preset as VerticalPreset | undefined) ?? null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("title")} description={t("intro")} />

      {applied ? (
        <section className="flex flex-col gap-2 rounded-lg border p-4">
          <p className="text-sm font-medium">{t("alreadyApplied", { name: applied.name })}</p>
          <p className="text-sm text-muted-foreground">{t("alreadyAppliedHelp")}</p>
          {firstType && tenant ? (
            <a className="text-sm underline" href={`${env.APP_URL}/b/${tenant.slug}/${firstType.slug}`}>
              {`${env.APP_URL}/b/${tenant.slug}/${firstType.slug}`}
            </a>
          ) : null}
        </section>
      ) : null}

      {!applied && preset && draft ? (
        <section className="flex flex-col gap-4 rounded-lg border p-4">
          <p className="text-sm font-medium">{t("assistant.previewTitle")}</p>
          <PresetPreview preset={preset} t={t} />
          <div className="flex gap-2">
            <form action={applySetupPlanAction}>
              <input type="hidden" name="planId" value={draft.id} />
              <Button type="submit" size="sm">
                {t("assistant.applyPlan")}
              </Button>
            </form>
            <form action={discardSetupPlanAction}>
              <input type="hidden" name="planId" value={draft.id} />
              <Button type="submit" size="sm" variant="outline">
                {t("assistant.startOver")}
              </Button>
            </form>
          </div>
        </section>
      ) : null}

      {!applied && !preset ? (
        <section className="flex flex-col gap-4 rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("assistant.cta")}</p>
            <p className="text-sm text-muted-foreground">{t("assistant.intro")}</p>
          </div>

          {conversation && isConversationComplete(conversation) ? (
            // The conversation finished but no plan came back: no driver
            // configured, the tenant's daily cap, or a model that never
            // produced valid JSON. The picker below always still works.
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">{t("assistant.generationFailed")}</p>
              <form action={retrySetupPlanAction}>
                <Button type="submit" size="sm" variant="outline">
                  {t("assistant.retry")}
                </Button>
              </form>
            </div>
          ) : (
            <SetupAssistantStep conversation={conversation} t={t} />
          )}
        </section>
      ) : null}

      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {applied ? t("title") : t("assistant.pickerLink")}
        </summary>
        <ul className="mt-4 grid gap-4 md:grid-cols-2">
          {VERTICAL_PRESETS.map((option) => (
            <li key={option.slug} className="flex flex-col gap-3 rounded-lg border p-4">
              <div>
                <p className="font-medium">{option.name}</p>
                <p className="text-sm text-muted-foreground">{option.description}</p>
              </div>
              <PresetPreview preset={option} t={t} />
              <form action={applyVerticalAction}>
                <input type="hidden" name="vertical" value={option.slug} />
                <Button type="submit" size="sm" variant={applied ? "outline" : "default"}>
                  {t("apply")}
                </Button>
              </form>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">{t("additiveNote")}</p>
      </details>
    </div>
  );
}

function SetupAssistantStep({
  conversation,
  t,
}: {
  conversation: SetupConversationState | null;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const stepIndex = conversation?.stepIndex ?? 0;
  const topic = SETUP_TOPICS[stepIndex];
  if (!topic) return null;

  return (
    <form action={submitSetupAnswerAction} className="flex flex-col gap-3">
      <input type="hidden" name="topic" value={topic} />
      <p className="text-xs text-muted-foreground">
        {t("assistant.stepOf", { current: stepIndex + 1, total: SETUP_TOPICS.length })}
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t(`assistant.topics.${topic}`)}</span>
        <textarea
          name="answer"
          rows={3}
          className="rounded-md border bg-background p-2 text-sm"
          autoFocus
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t("assistant.continueButton")}
        </Button>
        <Button type="submit" name="skip" value="1" size="sm" variant="ghost">
          {t("assistant.skip")}
        </Button>
      </div>
    </form>
  );
}
