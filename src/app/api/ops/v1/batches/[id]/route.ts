import { listOpsRows, requireOwnBatch } from "@/modules/ops";
import {
  authenticateOpsRequest,
  json,
  opsErrorResponse,
  serializeBatch,
  serializeRow,
} from "@/modules/ops/http";

// GET /api/ops/v1/batches/{id} — one batch with its rows and the owner's raw
// text. Another token's batch answers 404, not 403 (see modules/ops/guard.ts).

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateOpsRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const batch = await requireOwnBatch(auth.token, id);
    const rows = await listOpsRows(auth.token, batch.id);
    return json({ batch: serializeBatch(batch), rows: rows.map(serializeRow) });
  } catch (err) {
    return opsErrorResponse(err);
  }
}
