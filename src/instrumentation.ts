// Next.js `register()` hook (https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation) —
// starts the job queue worker in-process and wires up Sentry (PLAN.md §10
// 1H #4). Skipped outside the Node.js runtime (e.g. edge) and during the
// build phase, which also imports this module but has no live
// DATABASE_URL/worker to run.
export async function register() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    const { startWorker } = await import("@/worker");
    startWorker();

    // Points the Telegram bot at this deployment (no-op when unconfigured),
    // so turning the feature on is three env vars and a restart.
    const { registerTelegramWebhook } = await import("@/modules/notifications/telegram");
    const { env } = await import("@/lib/config/env");
    void registerTelegramWebhook(env.APP_URL);
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export { captureRequestError as onRequestError } from "@sentry/nextjs";
