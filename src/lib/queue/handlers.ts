export type JobContext = {
  jobId: string;
  tenantId: string | null;
  attempts: number;
};

export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<void>;

const registry = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler): void {
  if (registry.has(type)) {
    throw new Error(`Job handler already registered for type "${type}"`);
  }
  registry.set(type, handler);
}

export function getJobHandler(type: string): JobHandler | undefined {
  return registry.get(type);
}
