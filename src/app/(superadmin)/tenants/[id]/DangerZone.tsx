"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-fields";
import { deleteTenantAction, type DeleteTenantState } from "../actions";

// Deleting a business, behind its slug typed out. Suspending sits in the page
// header as one click because it can be undone; this cannot, so it lives at
// the bottom of the page and the button stays disabled until the operator
// has typed which business they mean.

const initial: DeleteTenantState = { error: null };

export function DangerZone({ tenantId, slug }: { tenantId: string; slug: string }) {
  const t = useTranslations("superadmin.tenants.danger");
  const [state, formAction, pending] = useActionState(deleteTenantAction, initial);
  const [typed, setTyped] = useState("");

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-4">
      <div>
        <h2 className="text-lg font-semibold text-destructive">{t("title")}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("body")}</p>
      </div>
      <form action={formAction} className="flex max-w-md flex-col gap-2">
        <input type="hidden" name="tenantId" value={tenantId} />
        <label className="flex flex-col gap-1 text-sm">
          <span>
            {t.rich("confirmLabel", { slug: () => <code className="font-mono">{slug}</code> })}
          </span>
          <Input
            name="confirm"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
          />
        </label>
        {state.error && (
          <p role="alert" className="text-xs text-destructive">
            {t(`errors.${state.error}` as "errors.unknown")}
          </p>
        )}
        <Button type="submit" variant="destructive" disabled={pending || typed.trim() !== slug}>
          {t("submit")}
        </Button>
      </form>
    </section>
  );
}
