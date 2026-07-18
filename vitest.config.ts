import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    // Integration tests share one real MySQL instance, including a single
    // `jobs` queue table — running test files in parallel lets one file's
    // worker.tick() steal-claim a job another file just enqueued (SKIP
    // LOCKED prevents double-processing, not cross-file interleaving).
    // Serializing file execution removes that race entirely; within a file,
    // tests still run in the order they're declared.
    fileParallelism: false,
    // These tests drain a real job queue against a real MySQL instance in a
    // loop (up to ~200 round trips) — the 5s default is too tight under any
    // resource contention and produces a hard timeout, not an assertion
    // failure, when that happens.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
