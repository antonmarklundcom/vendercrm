"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Moon, Sun } from "lucide-react";

import { authClient } from "@/lib/auth/client";
import { cn } from "@/lib/utils";
import { setThemeAction } from "@/app/theme-actions";
import type { Theme } from "@/lib/theme";

// Identity + sign out. Before 1I nothing in the app called signOut at all —
// a session ran until its cookie expired, which is untenable on a shared
// machine and made testing two roles a browser-profile juggling act.
//
// Labels arrive pre-translated from the server layout (§1.2).

export function UserMenu({
  name,
  email,
  subtitle,
  signOutLabel,
  variant = "sidebar",
  theme,
  themeToggleLabel,
}: {
  name: string;
  email: string;
  /** Role, tenant name, or "Superadmin" — whatever identifies the session. */
  subtitle?: string;
  signOutLabel: string;
  /** `sidebar` stacks under the nav; `bar` is the single-row mobile/top form. */
  variant?: "sidebar" | "bar";
  /** Resolved appearance (never "system" — the server already picked a side
   * to render). Omitted hides the toggle, e.g. on the mobile bar variant
   * where there isn't room for it. */
  theme?: Exclude<Theme, "system">;
  themeToggleLabel?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const nextTheme: Theme = theme === "dark" ? "light" : "dark";
  const themeToggle = theme && (
    <form action={setThemeAction}>
      <input type="hidden" name="theme" value={nextTheme} />
      <button
        type="submit"
        title={themeToggleLabel}
        aria-label={themeToggleLabel}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {theme === "dark" ? (
          <Sun className="size-4" aria-hidden="true" />
        ) : (
          <Moon className="size-4" aria-hidden="true" />
        )}
      </button>
    </form>
  );

  function handleSignOut() {
    setFailed(false);
    startTransition(async () => {
      try {
        await authClient.signOut();
      } catch {
        // The cookie may already be gone server-side; a redirect to /login
        // resolves either way, so only a genuine network failure surfaces.
        setFailed(true);
        return;
      }
      router.push("/login");
      router.refresh();
    });
  }

  const button = (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-foreground disabled:opacity-60",
        failed && "text-destructive",
      )}
    >
      <LogOut className="size-4 shrink-0" aria-hidden="true" />
      <span className={variant === "bar" ? "sr-only sm:not-sr-only" : undefined}>
        {signOutLabel}
      </span>
    </button>
  );

  if (variant === "bar") {
    return (
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {subtitle ?? email}
          </span>
        </span>
        <span className="flex shrink-0 items-center">
          {themeToggle}
          {button}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t px-3 pt-3">
      <div className="flex min-w-0 flex-col px-1">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{email}</span>
        {subtitle && (
          <span className="truncate text-xs text-muted-foreground/80">{subtitle}</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-1">
        {button}
        {themeToggle}
      </div>
    </div>
  );
}
