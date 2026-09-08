import { provisionTestLead } from "@/modules/ops";
import { authenticateOpsRequest, json, opsErrorResponse } from "@/modules/ops/http";

// POST /api/ops/v1/rows/{id}/test-lead (step 5 of five). Proves the whole
// chain — key, site, pipeline, routing — with a fixed lead, then hands the
// row to the owner: state `awaiting_approval`, and the site still inactive
// until he clicks (§18.1.4).

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateOpsRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const result = await provisionTestLead(auth.token, id);
    return json(
      {
        contact_id: result.contactId,
        deal_id: result.dealId,
        state: "awaiting_approval",
        repeated: result.repeated,
      },
      result.repeated ? 200 : 201,
    );
  } catch (err) {
    return opsErrorResponse(err);
  }
}
