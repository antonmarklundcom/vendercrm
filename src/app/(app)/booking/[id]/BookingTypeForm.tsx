"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form-fields";
import { saveBookingTypeAction, type FormState } from "./actions";

// The interactive half of /booking/[id]. Copy comes from next-intl on the
// client (the pattern SiteTurnstileForm established) rather than a labels
// prop: this form has enough fields that threading every string through the
// server page would be its own maintenance problem.

const initialState: FormState = { error: null, saved: false, values: {} };

export type Question = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "email";
  required?: boolean;
  options?: string[];
};

export type BookingTypeValues = {
  name: string;
  slug: string;
  description: string;
  isActive: boolean;
  color: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  slotIncrementMinutes: number | null;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  maxPerDay: number | null;
  capacity: number;
  depositAmount: number | null;
  allowMultiService: boolean;
  depositExpiryMinutes: number;
  assignment: "any" | "round_robin";
  locationMode: "in_person" | "phone" | "video" | "whatsapp";
  locationDetail: string;
  createDeal: boolean;
  defaultPipelineId: string;
  defaultStageId: string;
  defaultOwnerUserId: string;
  defaultTagIds: string[];
  turnstileSiteId: string;
  requireTurnstile: boolean;
  reminderMinutes: number;
  cancellationCutoffMinutes: number;
  confirmationMessage: string;
  questions: Question[];
};

type Option = { id: string; name: string };

export function BookingTypeForm({
  bookingTypeId,
  values,
  pipelines,
  stagesByPipeline,
  users,
  tags,
  turnstileSites,
}: {
  bookingTypeId: string;
  values: BookingTypeValues;
  pipelines: Option[];
  stagesByPipeline: Record<string, Option[]>;
  users: Option[];
  tags: Option[];
  turnstileSites: Option[];
}) {
  const t = useTranslations("app.booking.detail");
  const tb = useTranslations("app.booking");
  const bound = saveBookingTypeAction.bind(null, bookingTypeId);
  const [state, action, pending] = useActionState<FormState, FormData>(bound, initialState);

  const [pipelineId, setPipelineId] = useState(values.defaultPipelineId);
  const [questions, setQuestions] = useState<Question[]>(values.questions);

  const stages = stagesByPipeline[pipelineId] ?? [];

  return (
    <form action={action} className="flex flex-col gap-8">
      <Section title={t("basicsTitle")} help={t("basicsHelp")}>
        <Field label={tb("name")}>
          <Input name="name" defaultValue={values.name} />
        </Field>
        <Field label={tb("slug")}>
          <Input name="slug" defaultValue={values.slug} />
        </Field>
        <Field label={t("color")}>
          <Input name="color" defaultValue={values.color} placeholder="#0f766e" />
        </Field>
        <Field label={t("description")} wide>
          <Textarea name="description" rows={3} defaultValue={values.description} />
        </Field>
        <Check name="isActive" defaultChecked={values.isActive} label={t("isActive")} />
      </Section>

      <Section title={t("timingTitle")} help={t("timingHelp")}>
        <Field label={tb("duration")}>
          <Input name="durationMinutes" type="number" min={1} defaultValue={values.durationMinutes} />
        </Field>
        <Field label={t("bufferBefore")}>
          <Input
            name="bufferBeforeMinutes"
            type="number"
            min={0}
            defaultValue={values.bufferBeforeMinutes}
          />
        </Field>
        <Field label={t("bufferAfter")}>
          <Input
            name="bufferAfterMinutes"
            type="number"
            min={0}
            defaultValue={values.bufferAfterMinutes}
          />
        </Field>
        <Field label={t("slotIncrement")} help={t("slotIncrementHelp")}>
          <Input
            name="slotIncrementMinutes"
            type="number"
            min={1}
            defaultValue={values.slotIncrementMinutes ?? ""}
          />
        </Field>
        <Field label={t("minNotice")} help={t("minNoticeHelp")}>
          <Input name="minNoticeMinutes" type="number" min={0} defaultValue={values.minNoticeMinutes} />
        </Field>
        <Field label={t("maxAdvance")}>
          <Input name="maxAdvanceDays" type="number" min={1} defaultValue={values.maxAdvanceDays} />
        </Field>
        <Field label={t("maxPerDay")} help={t("maxPerDayHelp")}>
          <Input name="maxPerDay" type="number" min={1} defaultValue={values.maxPerDay ?? ""} />
        </Field>
        <Field label={t("cancellationCutoff")} help={t("cancellationCutoffHelp")}>
          <Input
            name="cancellationCutoffMinutes"
            type="number"
            min={0}
            defaultValue={values.cancellationCutoffMinutes}
          />
        </Field>
        <Field label={t("reminderMinutes")} help={t("reminderMinutesHelp")}>
          <Input name="reminderMinutes" type="number" min={0} defaultValue={values.reminderMinutes} />
        </Field>
      </Section>

      <Section title={t("capacityTitle")} help={t("capacityHelp")}>
        <Field label={t("capacity")} help={t("capacityFieldHelp")}>
          <Input name="capacity" type="number" min={1} defaultValue={values.capacity} />
        </Field>
        <Field label={t("depositAmount")} help={t("depositAmountHelp")}>
          <Input
            name="depositAmount"
            type="number"
            min={0}
            step={1}
            defaultValue={values.depositAmount ?? ""}
          />
        </Field>
        <Field label={t("depositExpiry")} help={t("depositExpiryHelp")}>
          <Input
            name="depositExpiryMinutes"
            type="number"
            min={5}
            defaultValue={values.depositExpiryMinutes}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="allowMultiService"
            defaultChecked={values.allowMultiService}
          />
          {t("allowMultiService")}
        </label>
      </Section>

      <Section title={t("assignmentTitle")} help={t("assignmentHelp")}>
        <Field label={t("assignment")}>
          <Select name="assignment" defaultValue={values.assignment}>
            <option value="any">{t("assignmentAny")}</option>
            <option value="round_robin">{t("assignmentRoundRobin")}</option>
          </Select>
        </Field>
        <Field label={t("locationMode")}>
          <Select name="locationMode" defaultValue={values.locationMode}>
            <option value="in_person">{t("locationInPerson")}</option>
            <option value="phone">{t("locationPhone")}</option>
            <option value="video">{t("locationVideo")}</option>
            <option value="whatsapp">{t("locationWhatsapp")}</option>
          </Select>
        </Field>
        <Field label={t("locationDetail")} help={t("locationDetailHelp")} wide>
          <Input name="locationDetail" defaultValue={values.locationDetail} />
        </Field>
      </Section>

      <Section title={t("routingTitle")} help={t("routingHelp")}>
        <Check name="createDeal" defaultChecked={values.createDeal} label={t("createDeal")} />
        <Field label={t("pipeline")}>
          <Select
            name="defaultPipelineId"
            value={pipelineId}
            onChange={(event) => setPipelineId(event.target.value)}
          >
            <option value="">{t("none")}</option>
            {pipelines.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("stage")}>
          {/* Keyed on the pipeline so switching board resets the stage rather
              than leaving one from the previous board selected. */}
          <Select
            key={pipelineId}
            name="defaultStageId"
            defaultValue={values.defaultStageId}
            disabled={!pipelineId}
          >
            <option value="">{t("none")}</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("owner")}>
          <Select name="defaultOwnerUserId" defaultValue={values.defaultOwnerUserId}>
            <option value="">{t("none")}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
        </Field>
        {tags.length > 0 ? (
          <Field label={t("tags")} wide>
            <span className="flex flex-wrap gap-3 text-sm">
              {tags.map((tag) => (
                <label key={tag.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="defaultTagIds"
                    value={tag.id}
                    defaultChecked={values.defaultTagIds.includes(tag.id)}
                    className="size-4"
                  />
                  {tag.name}
                </label>
              ))}
            </span>
          </Field>
        ) : null}
      </Section>

      <Section title={t("questionsTitle")} help={t("questionsHelp")}>
        <div className="flex w-full flex-col gap-3">
          {questions.map((question, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2 rounded-md border p-3">
              {/* Controlled, not uncontrolled: removing a row shifts every
                  row after it down an index, and a DOM value left behind
                  would then belong to the wrong question. */}
              <Field label={t("questionLabel")}>
                <Input
                  name="qLabel"
                  value={question.label}
                  onChange={(event) => updateQuestion(index, { label: event.target.value })}
                />
              </Field>
              <Field label={t("questionKey")} help={t("questionKeyHelp")}>
                <Input
                  name="qKey"
                  value={question.key}
                  onChange={(event) => updateQuestion(index, { key: event.target.value })}
                  className="font-mono text-xs"
                />
              </Field>
              <Field label={t("questionType")}>
                <Select
                  name="qType"
                  value={question.type}
                  onChange={(event) =>
                    updateQuestion(index, { type: event.target.value as Question["type"] })
                  }
                >
                  <option value="text">{t("questionTypeText")}</option>
                  <option value="textarea">{t("questionTypeTextarea")}</option>
                  <option value="email">{t("questionTypeEmail")}</option>
                  <option value="select">{t("questionTypeSelect")}</option>
                </Select>
              </Field>
              <Field label={t("questionRequired")}>
                {/* A select, not a checkbox: an unchecked box posts nothing,
                    which would misalign the parallel arrays the action reads. */}
                <Select
                  name="qRequired"
                  value={question.required ? "1" : "0"}
                  onChange={(event) => updateQuestion(index, { required: event.target.value === "1" })}
                >
                  <option value="0">{t("no")}</option>
                  <option value="1">{t("yes")}</option>
                </Select>
              </Field>
              <Field label={t("questionOptions")} help={t("questionOptionsHelp")}>
                <Input
                  name="qOptions"
                  value={(question.options ?? []).join(", ")}
                  onChange={(event) =>
                    updateQuestion(index, { options: event.target.value.split(",") })
                  }
                  /* readOnly, not disabled: a disabled field posts nothing,
                     and the action reads these as index-aligned arrays. */
                  readOnly={question.type !== "select"}
                />
              </Field>
              <button
                type="button"
                className="text-xs underline text-destructive"
                onClick={() => setQuestions((current) => current.filter((_, i) => i !== index))}
              >
                {t("removeQuestion")}
              </button>
            </div>
          ))}
          <div>
            <button
              type="button"
              className="text-xs underline"
              onClick={() =>
                setQuestions((current) => [...current, { key: "", label: "", type: "text" }])
              }
            >
              {t("addQuestion")}
            </button>
          </div>
        </div>
      </Section>

      <Section title={t("protectionTitle")} help={t("protectionHelp")}>
        <Field label={t("turnstileSite")} help={t("turnstileSiteHelp")}>
          <Select name="turnstileSiteId" defaultValue={values.turnstileSiteId}>
            <option value="">{t("none")}</option>
            {turnstileSites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </Select>
        </Field>
        <Check
          name="requireTurnstile"
          defaultChecked={values.requireTurnstile}
          label={t("requireTurnstile")}
        />
        <Field label={t("confirmationMessage")} help={t("confirmationMessageHelp")} wide>
          <Textarea name="confirmationMessage" rows={2} defaultValue={values.confirmationMessage} />
        </Field>
      </Section>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        {state.error ? (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${state.error}` as "errors.nameRequired")}
          </p>
        ) : null}
        {state.saved ? <p className="text-sm text-muted-foreground">{t("saved")}</p> : null}
      </div>
    </form>
  );

  function updateQuestion(index: number, patch: Partial<Question>) {
    setQuestions((current) =>
      current.map((question, position) =>
        position === index ? { ...question, ...patch } : question,
      ),
    );
  }
}

function Section({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{help}</p>
      </div>
      <div className="flex flex-wrap items-end gap-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  help,
  wide,
  children,
}: {
  label: string;
  help?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${wide ? "w-full" : ""}`}>
      {label}
      {children}
      {help ? <span className="text-xs text-muted-foreground">{help}</span> : null}
    </label>
  );
}

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4" />
      {label}
    </label>
  );
}
