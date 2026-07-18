import { db } from "@/db/client";
import { jobs } from "@/db/schema/jobs";

export type EnqueueOptions = {
  tenantId?: string;
  runAt?: Date;
  maxAttempts?: number;
};

export async function enqueue(
  type: string,
  payload: unknown,
  options: EnqueueOptions = {},
): Promise<string> {
  const [inserted] = await db
    .insert(jobs)
    .values({
      type,
      payload,
      tenantId: options.tenantId ?? null,
      runAt: options.runAt ?? new Date(),
      maxAttempts: options.maxAttempts ?? 5,
    })
    .$returningId();

  return inserted.id;
}
