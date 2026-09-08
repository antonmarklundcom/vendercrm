import { z } from "zod";
import { requireOwnBatch, requireOwnRow, updateOpsRow } from "@/modules/ops";
import { OpsAccessError } from "@/modules/ops/guard";
import {
  authenticateOpsRequest,
  json,
  opsErrorResponse,
  opsRowDetailsSchema,
  readJson,
  serializeRow,
} from "@/modules/ops/http";

// PATCH /api/ops/v1/batches/{id}/rows/{rowId} — what the session learned:
// a corrected owner e-mail, the stages the client actually wants, a note for
// the owner, or `needs_input` when a row cannot proceed without an answer.
//
// It cannot set `live` or `awaiting_approval`: a session must not be able to
// mark its own work approved (§18.1.4), so those two states are written only
// by the test-lead step and by the owner's click on the page.

const bodySchema = z
  .object({
    display_name: z.string().min(1).max(200).optional(),
    tenant_mode: z.enum(["new", "existing"]).optional(),
    tenant_id: z.string().min(1).max(26).nullish(),
    details: opsRowDetailsSchema.optional(),
    needs_input: z.string().max(2000).nullish(),
    state: z.enum(["pending", "needs_input"]).optional(),
  })
  .strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; rowId: string }> },
) {
  const auth = await authenticateOpsRequest(request);
  if (!auth.ok) return auth.response;

  const { id, rowId } = await params;
  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;

  try {
    // Both halves of the path are checked: a row id that belongs to another
    // batch of the same token is still the wrong URL, and saying so keeps the
    // session's mental model honest.
    await requireOwnBatch(auth.token, id);
    const existing = await requireOwnRow(auth.token, rowId);
    if (existing.batchId !== id) throw new OpsAccessError(404, "row not found");

    const row = await updateOpsRow(auth.token, rowId, {
      display_name: body.data.display_name,
      tenant_mode: body.data.tenant_mode,
      tenant_id: body.data.tenant_id === undefined ? undefined : body.data.tenant_id,
      details: body.data.details,
      needs_input: body.data.needs_input === undefined ? undefined : body.data.needs_input,
      state: body.data.state,
    });

    return json({ row: serializeRow(row) });
  } catch (err) {
    return opsErrorResponse(err);
  }
}
