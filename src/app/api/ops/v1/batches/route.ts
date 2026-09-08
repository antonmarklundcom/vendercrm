import { z } from "zod";
import { createOpsBatch, listOpsBatches, listOpsRows } from "@/modules/ops";
import {
  authenticateOpsRequest,
  json,
  opsErrorResponse,
  readJson,
  serializeBatch,
  serializeRow,
} from "@/modules/ops/http";
import { writeOpsAudit } from "@/modules/ops/audit";

// POST/GET /api/ops/v1/batches (PLAN.md §18.3). A batch is the unit of work
// and it is optional (§18.1.5): "new site for a dentist" is a perfectly good
// one-line title, and the owner's pasted list is the same object with
// `raw_text` filled in.

const createBatchSchema = z.object({
  title: z.string().min(1).max(200),
  raw_text: z.string().max(20_000).optional(),
});

export async function POST(request: Request) {
  const auth = await authenticateOpsRequest(request);
  if (!auth.ok) return auth.response;

  const body = await readJson(request, createBatchSchema);
  if (!body.ok) return body.response;

  try {
    const batch = await createOpsBatch(auth.token, {
      title: body.data.title,
      rawText: body.data.raw_text ?? null,
    });

    await writeOpsAudit(auth.token, null, {
      action: "ops.batch_created",
      entity: "ops_batch",
      entityId: batch.id,
      payload: { title: batch.title },
    });

    return json({ batch: serializeBatch(batch) }, 201);
  } catch (err) {
    return opsErrorResponse(err);
  }
}

export async function GET(request: Request) {
  const auth = await authenticateOpsRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const batches = await listOpsBatches(auth.token);
    const withRows = [];
    for (const batch of batches) {
      const rows = await listOpsRows(auth.token, batch.id);
      withRows.push({ ...serializeBatch(batch), rows: rows.map(serializeRow) });
    }
    return json({ batches: withRows });
  } catch (err) {
    return opsErrorResponse(err);
  }
}
