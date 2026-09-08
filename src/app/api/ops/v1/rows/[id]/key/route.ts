import { z } from "zod";
import { provisionKey } from "@/modules/ops";
import {
  authenticateOpsRequest,
  json,
  opsErrorResponse,
  readOptionalJson,
} from "@/modules/ops/http";

// POST /api/ops/v1/rows/{id}/key (step 4 of five). The plaintext key exists
// in this response and nowhere else — it is what goes into the website's
// VENDERCRM_API_KEY. A repeat returns the same key id with `api_key: null`,
// because there is no plaintext to fetch back and re-issuing would spend the
// site's rotation slot.

const bodySchema = z.object({ label: z.string().min(1).max(100).optional() }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateOpsRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  // The body is optional: `label` is the only thing in it.
  const body = await readOptionalJson(request, bodySchema);
  if (!body.ok) return body.response;
  const label = body.data?.label;

  try {
    const result = await provisionKey(auth.token, id, label);
    return json(
      {
        api_key_id: result.keyId,
        api_key: result.plaintext,
        repeated: result.repeated,
      },
      result.repeated ? 200 : 201,
    );
  } catch (err) {
    return opsErrorResponse(err);
  }
}
