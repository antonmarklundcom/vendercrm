// Light/dark appearance (PLAN.md §14 I3). globals.css has shipped a complete
// dark OKLCH token set with documented contrast ratios since the design pass;
// nothing ever put the `.dark` class on the page, so the whole palette was
// dead code. This is the switch.
//
// Same shape as the locale preference (lib/i18n/locales.ts): a per-user
// choice stored on the users row, with a cookie carrying it before the row
// can be read — the cookie is also what the pre-hydration script reads, since
// it must decide before any React has run.

export const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

/**
 * No preference means **light**, not "system". The app's public surfaces —
 * a quote link, a booking page, the marketing site — share this stylesheet
 * and are read by customers who never chose anything; letting the OS flip
 * those to dark would be a redesign nobody asked for. Dark is opt-in, and
 * `system` is one of the things a person can opt into.
 */
export const DEFAULT_THEME: Theme = "light";

/** Cookie carrying the choice for the pre-hydration script and for anyone
 * not signed in. Once signed in, `users.theme` is the source of truth and
 * the cookie is kept in step with it. */
export const THEME_COOKIE = "vc_theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function toTheme(value: unknown, fallback: Theme = DEFAULT_THEME): Theme {
  return isTheme(value) ? value : fallback;
}

/**
 * The class the server can put on `<html>` without guessing. `system` is
 * deliberately absent: the server cannot know the visitor's OS setting, so
 * it renders light and the inline script below corrects it before paint.
 */
export function themeClass(theme: Theme): string {
  return theme === "dark" ? "dark" : "";
}

/**
 * Runs before the first paint, from `<head>`, so a dark-mode user never sees
 * a white flash (the whole reason this is an inline script and not an
 * effect). It re-reads the cookie rather than being handed a value, so the
 * markup it corrects can be a cached static page.
 *
 * Kept as a string constant so it can be asserted in a test — a script that
 * throws would silently leave every user on light.
 */
export const THEME_SCRIPT = `(function(){try{
var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);
var t=m?decodeURIComponent(m[1]):"${DEFAULT_THEME}";
var q=window.matchMedia("(prefers-color-scheme: dark)");
var apply=function(){document.documentElement.classList.toggle("dark",t==="dark"||(t==="system"&&q.matches));};
apply();
if(t==="system"&&q.addEventListener)q.addEventListener("change",apply);
}catch(e){}})();`;
