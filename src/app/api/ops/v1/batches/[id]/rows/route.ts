import { z } from "zod";
import { addOpsRows } from "@/modules/ops";
import { writeOpsAudit } from "@/modules/ops/audit";
import {
  authenticateOpsRequest,
  json,
  opsErrorResponse,
  opsRowDetailsSchema,
  readJson,
  serializeRow,
} from "@/modules/ops/http";

// POST /api/ops/v1/batches/{id}/rows — the session writes one row per domain,
// from the owner's pasted text or from what it just built. The server never
// parses `raw_text` itself (§18.1.5): reading a human's list is exactly the
// job the session is better at.

const rowSchema = z.object({
  domain: z.string().min(3).max(255),
  display_name: z.string().min(1).max(200),
  tenant_mode: z.enum(["new", "existing"]).optional(),
  tenant_id: z.string().min(1).max(26).nullish(),
  details: opsRowDetailsSchema.optional(),
});

const bodySchema = z.object({ rows: z.array(rowSchema).min(1).max(50) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateOpsRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;

  try {
    const rows = await addOpsRows(auth.token, id, body.data.rows);

    await writeOpsAudit(auth.token, rows[0] ?? null, {
      action: "ops.rows_added",
      entity: "ops_batch",
      entityId: id,
      payload: { count: rows.length, domains: rows.map((row) => row.domain) },
    });

    return json({ rows: rows.map(serializeRow) }, 201);
  } catch (err) {
    return opsErrorResponse(err);
  }
}
