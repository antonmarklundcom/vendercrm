import { provisionSite } from "@/modules/ops";
import { authenticateOpsRequest, json, opsErrorResponse } from "@/modules/ops/http";

// POST /api/ops/v1/rows/{id}/site (step 2 of five). The site is born
// inactive (§18.1.4) and stays that way until the owner approves the row on
// /claude-ops — nothing a session sends can change that.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateOpsRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const result = await provisionSite(auth.token, id);
    return json(
      {
        site_id: result.siteId,
        slug: result.slug,
        is_active: result.isActive,
        repeated: result.repeated,
      },
      result.repeated ? 200 : 201,
    );
  } catch (err) {
    return opsErrorResponse(err);
  }
}
