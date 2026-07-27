// Error reporting (PLAN.md §10 1H).
//
// Deliberately not bound to Sentry: adding the SDK would pull in a
// dependency and require an account before the app can even boot. Instead
// every unexpected failure is funnelled through one function that emits a
// structured line, and wiring a real reporter is a change in exactly one
// place — see docs/deploy/hostinger.md.
//
// Structured rather than free text so Hostinger's log view can be grepped
// by `event` and `scope` when something goes wrong in production.

export type ErrorContext = {
  scope: string;
  tenantId?: string | null;
  [key: string]: unknown;
};

export function reportError(error: unknown, context: ErrorContext): void {
  const payload = {
    event: "error",
    ...context,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    at: new Date().toISOString(),
  };

  console.error(JSON.stringify(payload));

  // Wire a reporter here when you have one, e.g.:
  //   Sentry.captureException(error, { extra: context });
}

export function reportEvent(event: string, context: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...context, at: new Date().toISOString() }));
}
