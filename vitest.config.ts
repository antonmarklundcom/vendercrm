import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // tsconfig sets `jsx: "preserve"` for Next; vitest transforms with oxc,
  // which needs to be told what to do with the JSX it then sees — otherwise
  // a suite that imports a .tsx module (the PDF renderers) fails to parse
  // (PLAN.md §13 H9).
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    // The DB-backed suites all point at one MySQL and share global tables
    // (jobs above all), so files must not run concurrently — a parallel run
    // has them claiming each other's rows.
    fileParallelism: false,
    // Claude Code agent worktrees land under .claude/worktrees/ as full
    // nested copies of the repo (see .gitignore) — without this, a run from
    // the outer repo also picks up their duplicate test files.
    exclude: ["**/node_modules/**", "**/.claude/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
