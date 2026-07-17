"use client";

import { use } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { acceptInviteAction, type AcceptInviteState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: AcceptInviteState = { error: null };

export default function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = use(searchParams);
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [state, formAction, pending] = useActionState(
    acceptInviteAction,
    initialState,
  );

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-xl font-semibold">{t("acceptInviteTitle")}</h1>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="token" value={token ?? ""} />
          <div className="grid gap-1.5">
            <Label htmlFor="name">{tc("name")}</Label>
            <Input id="name" name="name" required autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">{tc("password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              minLength={8}
              required
            />
          </div>
          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? tc("loading") : t("createAccount")}
          </Button>
        </form>
      </div>
    </div>
  );
}
