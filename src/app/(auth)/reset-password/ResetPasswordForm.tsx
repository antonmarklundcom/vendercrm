"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";

// The token arrives as a query param — Better Auth's callback route
// (GET /reset-password/:token) validates it server-side and redirects here
// with ?token=... attached (see requestPasswordResetCallback in
// better-auth's password routes); this form never sees the raw email link,
// only an already-validated token.
export function ResetPasswordForm() {
  const t = useTranslations("auth.resetPassword");
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-3 text-center">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-destructive">{t("invalidToken")}</p>
        <Link href="/forgot-password" className="text-sm underline underline-offset-4">
          {t("requestNew")}
        </Link>
      </div>
    );
  }

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const newPassword = String(formData.get("password") ?? "");

    const { error: resetError } = await authClient.resetPassword({
      newPassword,
      token: token!,
    });

    setPending(false);

    if (resetError) {
      setError(t("error"));
      return;
    }

    router.push("/login");
  }

  return (
    <form action={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <label className="flex flex-col gap-1 text-sm">
        {t("newPassword")}
        <PasswordInput name="password" required minLength={8} />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
