import { provisionTenant } from "@/modules/ops";
import { authenticateOpsRequest, json, opsErrorResponse } from "@/modules/ops/http";

// POST /api/ops/v1/rows/{id}/tenant (PLAN.md §18.3, step 1 of five).
// Creates the business and its first admin. The admin's password is random,
// never returned and never logged — they arrive through the reset e-mail.
// A repeat returns the tenant created the first time.

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
        reset_email_sent: result.resetEmailSent,
        repeated: result.repeated,
      },
      result.repeated ? 200 : 201,
    );
  } catch (err) {
    return opsErrorResponse(err);
  }
}
