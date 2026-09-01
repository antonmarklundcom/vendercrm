"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTenantContext } from "@/modules/tenancy/context";
import { setUserTheme } from "@/modules/tenancy/users";
import { THEMES, THEME_COOKIE } from "@/lib/theme";

const themeSchema = z.object({ theme: z.enum(THEMES) });

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Persists an appearance choice (PLAN.md §14 I3). Same split as the locale
 * action beside it: signed in it goes on the user row so the choice follows
 * them to another browser, and the cookie is written either way because the
 * pre-hydration script in the root layout can only read a cookie.
 */
export async function setThemeAction(formData: FormData) {
  const parsed = themeSchema.safeParse({ theme: formData.get("theme") });
  if (!parsed.success) return;

  const ctx = await getTenantContext();
  if (ctx) await setUserTheme(ctx.userId, parsed.data.theme);

  (await cookies()).set(THEME_COOKIE, parsed.data.theme, {
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
    path: "/",
  });

  revalidatePath("/", "layout");
}
