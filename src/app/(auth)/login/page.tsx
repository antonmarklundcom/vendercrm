"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "@/modules/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) {
      setError(t("invalidCredentials"));
      return;
    }
    // Root route redirects by role.
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-xl font-semibold">{t("loginTitle")}</h1>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="email">{tc("email")}</Label>
            <Input id="email" name="email" type="email" required autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">{tc("password")}</Label>
            <Input id="password" name="password" type="password" required />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? tc("loading") : t("login")}
          </Button>
        </form>
      </div>
    </div>
  );
}
