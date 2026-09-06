import { writeAuditLog } from "@/modules/tenancy/audit";
import type { TenantContext } from "@/modules/tenancy/context";

// Instrumentation for J8's start condition (PLAN.md §17.5, §17.2 P14): every
// time a Hoy item's action button is used — from the dashboard panel or
// from the morning push — one `coach.hoy_action` audit row records which
// kind and severity, and from where. Read together with the fortnightly
// owner check-ins §17.5 asks for, this is the objective half of "which Hoy
// rows people actually acted on."

export type HoyActionOrigin = "panel" | "push";

export async function recordHoyAction(
  ctx: TenantContext,
  input: { kind: string; severity: string; origin: HoyActionOrigin },
): Promise<void> {
  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    impersonatorUserId: ctx.impersonatorUserId,
    action: "coach.hoy_action",
    entity: "hoy_item",
    entityId: input.kind,
    payload: { kind: input.kind, severity: input.severity, origin: input.origin },
  });
}
