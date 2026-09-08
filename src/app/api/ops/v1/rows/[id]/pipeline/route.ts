import { provisionPipeline } from "@/modules/ops";
import { authenticateOpsRequest, json, opsErrorResponse } from "@/modules/ops/http";

// POST /api/ops/v1/rows/{id}/pipeline (step 3 of five). Pipeline, stages,
// any missing tags, and the site's routing defaults. An `owner_email` that
// names nobody in the business is a 422 with that e-mail in the reason — the
// session asks the owner rather than picking a default.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateOpsRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const result = await provisionPipeline(auth.token, id);
    return json(
      {
        pipeline_id: result.pipelineId,
        stage_ids: result.stageIds,
        tag_ids: result.tagIds,
        owner_user_id: result.ownerUserId,
        repeated: result.repeated,
      },
      result.repeated ? 200 : 201,
    );
  } catch (err) {
    return opsErrorResponse(err);
  }
}
