import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { getUserById } from "@/modules/tenancy/users";
import { DEFAULT_THEME, THEME_COOKIE, toTheme, type Theme } from "@/lib/theme";

/**
 * The appearance to render with (PLAN.md §14 I3), resolved the same way the
 * locale is (src/i18n/request.ts) — most specific first:
 *
 *   1. the cookie, which the switcher always writes and the pre-hydration
 *      script reads
 *   2. the signed-in user's stored choice, so it follows them to a browser
 *      that has never seen this app
 *   3. light
 *
 * The cookie comes first deliberately: it is the only one of the three the
 * inline script can see, so if the two ever disagree the page would flash on
 * every load while the script "corrected" the server's answer back.
 *
 * A Server Component cannot write cookies, so a user arriving on a fresh
 * browser costs one extra query per render until they touch the switcher.
 * That is one read on a path that already reads the user row for the locale,
 * and only until their first save.
 */
export async function resolveTheme(): Promise<Theme> {
  const cookieTheme = (await cookies()).get(THEME_COOKIE)?.value;
  if (cookieTheme) return toTheme(cookieTheme);

  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const userId = session?.user?.id;
    if (userId) {
      const user = await getUserById(userId);
      if (user?.theme) return toTheme(user.theme);
    }
  } catch {
    // Appearance is never worth failing a render over — same rule the locale
    // resolution follows. Fall through to the default.
  }

  return DEFAULT_THEME;
}
