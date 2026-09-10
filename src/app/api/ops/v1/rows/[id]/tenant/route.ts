import { provisionTenant } from "@/modules/ops";
import { authenticateOpsRequest, json, opsErrorResponse } from "@/modules/ops/http";

// POST /api/ops/v1/rows/{id}/tenant (PLAN.md §18.3, step 1 of five).
// Creates the business and grants the shared operator admin in it, so the
// owner reaches every business he provisions from one login. A row that also
// asks for its own admin (`details.admin_email`) gets one, with a random
// password that is never returned or logged — that person arrives through the
// reset e-mail. A repeat returns the tenant created the first time.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateOpsRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const result = await provisionTenant(auth.token, id);
    return json(
      {
        tenant_id: result.tenantId,
        admin_user_id: result.adminUserId,
        shared_admin_user_id: result.sharedAdminUserId,
        reset_email_sent: result.resetEmailSent,
        repeated: result.repeated,
      },
      result.repeated ? 200 : 201,
    );
  } catch (err) {
    return opsErrorResponse(err);
  }
}
