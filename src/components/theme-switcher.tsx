import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form-fields";
import { setThemeAction } from "@/app/theme-actions";
import { THEMES } from "@/lib/theme";
import { resolveTheme } from "@/lib/theme-resolve";

// One switcher, signed in (writes users.theme) and signed out (writes the
// cookie) — the action decides which, exactly as the language switcher does
// (PLAN.md §14 I3).
export async function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const t = await getTranslations("app.settings.theme");
  const current = await resolveTheme();

  return (
    <form action={setThemeAction} className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm">
        {!compact && <span>{t("label")}</span>}
        <Select name="theme" defaultValue={current} aria-label={t("label")}>
          {THEMES.map((value) => (
            <option key={value} value={value}>
              {t(`options.${value}`)}
            </option>
          ))}
        </Select>
      </label>
      <Button type="submit" size="sm" variant="outline">
        {t("save")}
      </Button>
    </form>
  );
}
