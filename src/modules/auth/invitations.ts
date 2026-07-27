import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import {
  getInvitationByToken,
  markInvitationAccepted,
} from "@/modules/tenancy/invitations";
import { assignUserToTenant } from "@/modules/tenancy/users";
import { writeAuditLog } from "@/modules/tenancy/audit";

// Accept-invite orchestration (PLAN.md §2.2 `(auth)` route group): creates
// the Better Auth user via the public sign-up endpoint (which cannot set
// tenantId/role — those are `input: false` additionalFields, see
// lib/auth/server.ts), then binds tenant + role server-side.

export type AcceptInvitationInput = {
  name: string;
  password: string;
};

export async function acceptInvitation(
  token: string,
  input: AcceptInvitationInput,
): Promise<{ userId: string }> {
  const invitation = await getInvitationByToken(token);
  if (!invitation) throw new Error("Invitación no encontrada");
  if (invitation.acceptedAt) throw new Error("Invitación ya utilizada");
  if (invitation.expiresAt.getTime() < Date.now()) {
    throw new Error("Invitación expirada");
  }

  const result = await auth.api.signUpEmail({
    body: {
      email: invitation.email,
      password: input.password,
      name: input.name,
    },
    headers: await headers(),
  });

  const userId = result.user.id;

  await assignUserToTenant(
    userId,
    invitation.tenantId,
    invitation.role as "admin" | "agent" | "client",
  );
  await markInvitationAccepted(invitation.id);

  await writeAuditLog({
    tenantId: invitation.tenantId,
    actorUserId: userId,
    action: "invitation.accepted",
    entity: "invitation",
    entityId: invitation.id,
  });

  return { userId };
}
