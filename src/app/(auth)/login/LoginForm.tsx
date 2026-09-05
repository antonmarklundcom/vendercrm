"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-fields";
import { PasswordInput } from "@/components/ui/password-input";

// Client component: hits /api/auth/sign-in/email directly, no server action
// (the module rule §2.2 applies to business logic, not to a thin wrapper
// around Better Auth's own client). On success a tenant user lands on the
// dashboard and a superadmin on the console — "/" is the marketing home and
// was never a useful destination for either (PLAN.md §13 H4).
export function LoginForm() {
  const t = useTranslations("auth.login");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);

    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    const { error: signInError } = await authClient.signIn.email({
      email,
      password,
    });

    setPending(false);

    if (signInError) {
      // 429 is the login limiter (lib/auth/login-rate-limit), not a wrong
      // password — saying "wrong credentials" there sends the user in
      // circles trying variations that can't be accepted yet.
      setError(signInError.status === 429 ? t("rateLimited") : t("error"));
      return;
    }

    const next = searchParams.get("next");
    if (next) {
      router.push(next);
    } else {
      const { data: session } = await authClient.getSession();
      const isSuperadmin = (session?.user as { isSuperadmin?: boolean } | undefined)?.isSuperadmin;
      router.push(isSuperadmin ? "/tenants" : "/dashboard");
    }
    router.refresh();
  }

  return (
    <form action={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <label className="flex flex-col gap-1 text-sm">
        {t("email")}
        <Input
          type="email"
          name="email"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("password")}
        <PasswordInput name="password" required />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>
        {t("submit")}
      </Button>
      <Link href="/forgot-password" className="text-center text-sm underline underline-offset-4">
        {t("forgotPassword")}
      </Link>
    </form>
  );
}
