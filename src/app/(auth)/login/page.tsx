import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "./LoginForm";
import { LanguageSwitcher } from "@/components/language-switcher";
import { InstallAppButton } from "@/components/install-app-button";

export default async function LoginPage() {
  const t = await getTranslations("auth.login");

  return (
    <>
      <Suspense>
        <LoginForm />
      </Suspense>
      {/* Signed out there is no user row to store the choice on, so this
          writes the cookie the request config falls back to. */}
      <LanguageSwitcher compact />
      {/* Android/Chrome only — beforeinstallprompt never fires on iOS Safari,
          so this renders nothing there rather than a manual-steps fallback. */}
      <InstallAppButton label={t("installApp")} />
    </>
  );
}
