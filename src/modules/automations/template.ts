// {{contact.name}}-style variable substitution for action node text fields
// (PLAN.md §7.1). Values come from the run's context (trigger payload) plus
// live contact/deal rows loaded by the engine.

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") {
      return undefined;
    }
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

export function resolveTemplate(
  text: string,
  vars: { contact?: unknown; deal?: unknown; trigger?: unknown },
): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, path: string) => {
    const value = getPath(vars, path);
    return value === undefined || value === null ? "" : String(value);
  });
}
