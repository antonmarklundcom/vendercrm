import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, THEME_COOKIE, THEME_SCRIPT, themeClass, toTheme } from "./theme";

// Appearance (PLAN.md §14 I3). The pieces worth pinning are the ones that
// decide what a *stranger* sees: a customer opening a quote link never chose
// anything, and must not be handed a dark document because their laptop is
// in dark mode.

describe("theme preference", () => {
  it("treats no preference as light, not as the OS setting", () => {
    expect(DEFAULT_THEME).toBe("light");
    expect(toTheme(undefined)).toBe("light");
    expect(toTheme("")).toBe("light");
    expect(toTheme("solarized")).toBe("light");
  });

  it("accepts the three real choices", () => {
    expect(toTheme("system")).toBe("system");
    expect(toTheme("light")).toBe("light");
    expect(toTheme("dark")).toBe("dark");
  });

  it("only puts the class on the server when it is certain", () => {
    // "system" is the browser's answer to give, not the server's — rendering
    // it dark would flash for a light-mode user on every load.
    expect(themeClass("dark")).toBe("dark");
    expect(themeClass("light")).toBe("");
    expect(themeClass("system")).toBe("");
  });
});

describe("pre-hydration script", () => {
  it("reads the cookie the action writes", () => {
    expect(THEME_SCRIPT).toContain(THEME_COOKIE);
  });

  it("cannot throw a page into a white flash", () => {
    // It runs before anything else on the page: an exception here would
    // leave every dark-mode user on the light palette with no way to tell.
    expect(THEME_SCRIPT).toContain("try{");
    expect(THEME_SCRIPT).toContain("catch");
  });

  it("applies dark for an explicit choice and for system-when-dark", () => {
    const run = (cookie: string, systemDark: boolean) => {
      const classes = new Set<string>();
      const listeners: Array<() => void> = [];
      const context = {
        document: {
          cookie,
          documentElement: {
            classList: {
              toggle(name: string, on: boolean) {
                if (on) classes.add(name);
                else classes.delete(name);
              },
            },
          },
        },
        window: {
          matchMedia: () => ({
            matches: systemDark,
            addEventListener: (_: string, fn: () => void) => listeners.push(fn),
          }),
        },
      };
      new Function("document", "window", THEME_SCRIPT)(context.document, context.window);
      return classes.has("dark");
    };

    expect(run(`${THEME_COOKIE}=dark`, false)).toBe(true);
    expect(run(`${THEME_COOKIE}=light`, true)).toBe(false);
    expect(run(`${THEME_COOKIE}=system`, true)).toBe(true);
    expect(run(`${THEME_COOKIE}=system`, false)).toBe(false);
    // A visitor who never chose: the customer reading a quote link.
    expect(run("other=1", true)).toBe(false);
  });
});
