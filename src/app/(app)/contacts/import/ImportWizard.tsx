"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { IMPORTABLE_FIELDS } from "@/modules/crm/import-fields";
import {
  previewImportAction,
  runImportAction,
  type ImportState,
  type PreviewState,
} from "./actions";
import { Input, Select, Textarea } from "@/components/ui/form-fields";

// Declared here, not in actions.ts: a "use server" module may only export
// async functions.
const emptyPreview: PreviewState = {
  error: null,
  csv: null,
  headers: [],
  rowCount: 0,
  sample: [],
  mapping: {},
};

const emptyImport: ImportState = { error: null, report: null };

// One page, two steps: upload, then map. The mapping step re-posts the CSV
// text it was handed, so a reload or a back button costs the user a file
// pick and nothing else (PLAN.md §13 H6).
export function ImportWizard({
  tags,
  customFields,
}: {
  tags: Array<{ id: string; name: string }>;
  customFields: Array<{ key: string; label: string }>;
}) {
  const t = useTranslations("app.contacts.import");
  const [preview, previewAction, previewPending] = useActionState(
    previewImportAction,
    emptyPreview,
  );
  const [result, importAction, importPending] = useActionState(runImportAction, emptyImport);

  if (result.report) {
    const report = result.report;
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t("reportTitle")}</h2>

        {report.limitReached ? (
          <p className="rounded-md border border-warning/30 bg-warning-surface px-3 py-2 text-sm text-warning">
            {t("limitReached", {
              limit: report.limitReached.limit,
              current: report.limitReached.current,
            })}
          </p>
        ) : (
          <p className="text-sm">
            {t("reportSummary", {
              total: report.total,
              created: report.created,
              updated: report.updated,
              skipped: report.skipped,
              errors: report.errors.length,
            })}
          </p>
        )}

        {report.errors.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2">{t("errorRow")}</th>
                  <th className="py-2">{t("errorReason")}</th>
                </tr>
              </thead>
              <tbody>
                {report.errors.slice(0, 200).map((error) => (
                  <tr key={`${error.row}-${error.reason}`} className="border-b">
                    <td className="py-2">{error.row}</td>
                    <td className="py-2">
                      {t(`errorReasons.${error.reason}` as "errorReasons.failed")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.errors.length > 200 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("errorsTruncated", { count: report.errors.length - 200 })}
              </p>
            )}
          </div>
        )}

        <Link href="/contacts" className="text-sm underline underline-offset-4">
          {t("backToContacts")}
        </Link>
      </div>
    );
  }

  if (preview.csv) {
    return (
      <form action={importAction} className="flex flex-col gap-6">
        <input type="hidden" name="csv" value={preview.csv} />

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("mapTitle")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("mapIntro", { count: preview.rowCount })}
          </p>

          <div className="flex flex-col gap-2">
            {IMPORTABLE_FIELDS.map((field) => (
              <label key={field} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-40">
                  {t(`fields.${field}` as "fields.name")}
                  {(field === "phone" || field === "name") && " *"}
                </span>
                <Select
                  name={`map_${field}`}
                  defaultValue={preview.mapping[field] ?? ""}
                >
                  <option value="">{t("ignoreColumn")}</option>
                  {preview.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
            {customFields.map((field) => (
              <label key={field.key} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-40">{field.label}</span>
                <Select name={`map_custom_${field.key}`} defaultValue="">
                  <option value="">{t("ignoreColumn")}</option>
                  {preview.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("optionsTitle")}</h2>

          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-40">{t("onDuplicate")}</span>
            <Select
              name="onDuplicate"
              defaultValue="update"
            >
              <option value="update">{t("onDuplicateUpdate")}</option>
              <option value="skip">{t("onDuplicateSkip")}</option>
            </Select>
          </label>

          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-40">{t("tagOnImport")}</span>
            <Select name="tagId" defaultValue="">
              <option value="">{t("noTag")}</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </Select>
          </label>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("previewTitle")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  {preview.headers.map((header) => (
                    <th key={header} className="py-2 pr-4 whitespace-nowrap">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((row, index) => (
                  <tr key={index} className="border-b">
                    {preview.headers.map((header) => (
                      <td key={header} className="py-2 pr-4 whitespace-nowrap">
                        {row[header]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {result.error && (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${result.error}` as "errors.invalid")}
          </p>
        )}

        <div>
          <Button type="submit" disabled={importPending}>
            {importPending ? t("importing", { count: preview.rowCount }) : t("import")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form action={previewAction} className="flex max-w-2xl flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        {t("file")}
        <Input
          type="file"
          name="file"
          accept=".csv,text/csv"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("paste")}
        <Textarea
          name="pasted"
          rows={6}
          placeholder={t("pastePlaceholder")}
          className="font-mono text-xs"
        />
      </label>

      {preview.error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${preview.error}` as "errors.invalid")}
        </p>
      )}

      <div>
        <Button type="submit" disabled={previewPending}>
          {t("continue")}
        </Button>
      </div>
    </form>
  );
}
