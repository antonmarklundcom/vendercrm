"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form-fields";
import type { BusinessFact, FactKind } from "@/modules/memory/facts";
import {
  confirmFactAction,
  createFactAction,
  deleteFactAction,
  updateFactAction,
  updateProfileAction,
  type MemoryFormState,
} from "./actions";

// A "use server" module may only export async functions, so the shared
// initial state is declared here, exactly as /settings/SettingsForms.tsx does.
const initialMemoryState: MemoryFormState = { error: null, saved: false, values: {} };

// The memory page's forms (PLAN.md §16.1). One form per fact rather than one
// big JSON textarea, because the whole point of §16.2 rule 1 is that a fact
// has a kind: the price of a service and the cancellation policy are edited,
// retrieved and shown to a customer differently.

/** The profile fields, in the shape the page hands down. */
export type ProfileValues = {
  displayName: string;
  legalName: string;
  ruc: string;
  about: string;
  audience: string;
  differentiators: string;
  tone: string;
  toneNote: string;
  website: string;
  address: string;
  mapsUrl: string;
  neverPromise: string;
  paymentMethods: string;
};

function Feedback({ state }: { state: MemoryFormState }) {
  const t = useTranslations("app.memory");
  const tc = useTranslations("common");
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t(`errors.${state.error}` as "errors.unknown")}
      </p>
    );
  }
  if (state.saved) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {tc("saved")}
      </p>
    );
  }
  return null;
}

export function ProfileForm({ profile }: { profile: ProfileValues }) {
  const t = useTranslations("app.memory");
  const tc = useTranslations("common");
  const [state, formAction, pending] = useActionState(updateProfileAction, initialMemoryState);
  const value = (name: keyof ProfileValues) => state.values[name] ?? profile[name];

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("displayName")}>
          <Input name="displayName" defaultValue={value("displayName")} />
        </Field>
        <Field label={t("legalName")}>
          <Input name="legalName" defaultValue={value("legalName")} />
        </Field>
        <Field label={t("ruc")}>
          <Input name="ruc" defaultValue={value("ruc")} />
        </Field>
        <Field label={t("website")}>
          <Input name="website" defaultValue={value("website")} />
        </Field>
      </div>

      <Field label={t("about")} hint={t("aboutHint")}>
        <Textarea name="about" rows={3} defaultValue={value("about")} />
      </Field>
      <Field label={t("audience")}>
        <Textarea name="audience" rows={2} defaultValue={value("audience")} />
      </Field>
      <Field label={t("differentiators")}>
        <Textarea name="differentiators" rows={2} defaultValue={value("differentiators")} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("tone")}>
          <Select name="tone" defaultValue={value("tone")}>
            <option value="">{t("toneNone")}</option>
            <option value="cercano">{t("tones.cercano")}</option>
            <option value="formal">{t("tones.formal")}</option>
            <option value="directo">{t("tones.directo")}</option>
          </Select>
        </Field>
        <Field label={t("toneNote")}>
          <Input name="toneNote" defaultValue={value("toneNote")} />
        </Field>
        <Field label={t("address")}>
          <Input name="address" defaultValue={value("address")} />
        </Field>
        <Field label={t("mapsUrl")}>
          <Input name="mapsUrl" defaultValue={value("mapsUrl")} />
        </Field>
      </div>

      <Field label={t("paymentMethods")} hint={t("paymentMethodsHint")}>
        <Input name="paymentMethods" defaultValue={value("paymentMethods")} />
      </Field>
      <Field label={t("neverPromise")} hint={t("neverPromiseHint")}>
        <Textarea name="neverPromise" rows={2} defaultValue={value("neverPromise")} />
      </Field>

      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {tc("save")}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function FactsSection({ kind, facts }: { kind: FactKind; facts: BusinessFact[] }) {
  const t = useTranslations("app.memory");

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{t(`kinds.${kind}` as "kinds.faq")}</h2>
        <p className="text-sm text-muted-foreground">{t(`kindHints.${kind}` as "kindHints.faq")}</p>
      </div>

      {facts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {facts.map((fact) => (
            <li key={fact.id} className="rounded-md border p-3">
              <FactRow fact={fact} />
            </li>
          ))}
        </ul>
      )}

      <details className="rounded-md border border-dashed p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("addFact")}</summary>
        <div className="pt-3">
          <FactForm kind={kind} mode="create" />
        </div>
      </details>
    </section>
  );
}

function FactRow({ fact }: { fact: BusinessFact }) {
  const t = useTranslations("app.memory");
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{fact.title}</span>
          {fact.body && <span className="text-sm text-muted-foreground">{fact.body}</span>}
          <div className="flex flex-wrap gap-2 text-xs">
            {fact.visibility === "internal" && (
              // Marked in the list, not only in the edit form: an admin
              // scanning the page has to be able to see at a glance which
              // lines a customer will never be told (§16.2 rule 5).
              <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                {t("internalBadge")}
              </span>
            )}
            {!fact.confirmedAt && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                {t("unconfirmedBadge")}
              </span>
            )}
            {fact.source === "ai_suggested" && (
              <span className="text-muted-foreground">{t("aiSuggested")}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {!fact.confirmedAt && <ConfirmFactButton id={fact.id} />}
          <Button type="button" variant="outline" onClick={() => setEditing((on) => !on)}>
            {t("edit")}
          </Button>
          <DeleteFactButton id={fact.id} />
        </div>
      </div>
      {editing && <FactForm kind={fact.kind as FactKind} mode="edit" fact={fact} />}
    </div>
  );
}

function ConfirmFactButton({ id }: { id: string }) {
  const t = useTranslations("app.memory");
  const [, formAction, pending] = useActionState(confirmFactAction, initialMemoryState);
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" disabled={pending}>
        {t("confirm")}
      </Button>
    </form>
  );
}

function DeleteFactButton({ id }: { id: string }) {
  const t = useTranslations("app.memory");
  const [, formAction, pending] = useActionState(deleteFactAction, initialMemoryState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t("deleteConfirm"))) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="outline" disabled={pending}>
        {t("delete")}
      </Button>
    </form>
  );
}

export function FactForm({
  kind,
  mode,
  fact,
}: {
  kind: FactKind;
  mode: "create" | "edit";
  fact?: BusinessFact;
}) {
  const t = useTranslations("app.memory");
  const tc = useTranslations("common");
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createFactAction : updateFactAction,
    initialMemoryState,
  );
  const structured = (fact?.structured ?? {}) as Record<string, unknown>;
  const str = (key: string) => {
    const value = structured[key];
    return value === null || value === undefined ? "" : String(value);
  };

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="kind" value={kind} />
      {fact && <input type="hidden" name="id" value={fact.id} />}

      <Field label={t("factTitle")}>
        <Input name="title" defaultValue={state.values.title ?? fact?.title ?? ""} required />
      </Field>
      <Field label={t("factBody")}>
        <Textarea name="body" rows={2} defaultValue={state.values.body ?? fact?.body ?? ""} />
      </Field>

      {kind === "service" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("price")}>
            <Input name="price" inputMode="numeric" defaultValue={str("price")} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="priceFrom"
              defaultChecked={structured.priceFrom === true}
            />
            {t("priceFrom")}
          </label>
          <Field label={t("durationMinutes")}>
            <Input
              name="durationMinutes"
              inputMode="numeric"
              defaultValue={str("durationMinutes")}
            />
          </Field>
        </div>
      )}

      {kind === "promo" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("validFrom")}>
            <Input name="validFrom" type="date" defaultValue={str("validFrom")} />
          </Field>
          <Field label={t("validUntil")}>
            <Input name="validUntil" type="date" defaultValue={str("validUntil")} />
          </Field>
        </div>
      )}

      {kind === "policy" && (
        <Field label={t("topic")}>
          <Select name="topic" defaultValue={str("topic") || "other"}>
            <option value="cancellation">{t("topics.cancellation")}</option>
            <option value="deposit">{t("topics.deposit")}</option>
            <option value="payment">{t("topics.payment")}</option>
            <option value="warranty">{t("topics.warranty")}</option>
            <option value="other">{t("topics.other")}</option>
          </Select>
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("visibility")} hint={t("visibilityHint")}>
          <Select name="visibility" defaultValue={fact?.visibility ?? "customer"}>
            <option value="customer">{t("visibilityCustomer")}</option>
            <option value="internal">{t("visibilityInternal")}</option>
          </Select>
        </Field>
        <Field label={t("tags")}>
          <Input name="tags" defaultValue={(fact?.tags ?? []).join(", ")} />
        </Field>
      </div>

      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {mode === "create" ? tc("create") : tc("save")}
        </Button>
      </div>
    </form>
  );
}
