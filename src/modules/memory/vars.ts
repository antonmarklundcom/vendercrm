import type { TenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import type { BusinessFact, PolicyTopic } from "./facts";
import { listFacts } from "./facts";
import { getProfile } from "./profile";
import { resolveHours } from "./retrieve";

// `{{negocio.*}}` template variables (K3, PLAN.md §16.6) — the memory read
// through the one shape every template renderer (contracts today; whatever
// else registers them later) resolves against. Kept here, in the memory
// module, rather than in contracts/ or automations/, since it is a read of
// the memory and nothing else.

export const NEGOCIO_VARIABLE_NAMES = [
  "negocio.nombre",
  "negocio.horario",
  "negocio.direccion",
  "negocio.politica.cancelacion",
  "negocio.politica.senas",
  "negocio.pagos",
] as const;
export type NegocioVariableName = (typeof NEGOCIO_VARIABLE_NAMES)[number];

export type NegocioVars = Record<NegocioVariableName, string>;

function policyBody(facts: BusinessFact[], topic: PolicyTopic): string {
  const fact = facts.find(
    (row) => row.kind === "policy" && (row.structured as { topic?: string } | null)?.topic === topic,
  );
  return fact?.body ?? "";
}

/**
 * Everything `{{negocio.*}}` can resolve to, for one tenant. Reads only
 * confirmed, customer-visible facts (§16.2 rule 2, rule 5) — the same
 * discipline a customer-facing prompt follows, since a rendered contract or
 * flow message is customer-facing too.
 */
export async function getNegocioVars(ctx: TenantContext): Promise<NegocioVars> {
  const [tenant, profile, facts] = await Promise.all([
    getTenant(ctx.tenantId),
    getProfile(ctx),
    listFacts(ctx, { kind: ["location", "policy"], visibility: "customer", confirmedOnly: true }),
  ]);
  const settings = (tenant?.settings ?? {}) as TenantSettings;

  return {
    "negocio.nombre": profile?.displayName?.trim() || tenant?.name || "",
    "negocio.horario": resolveHours(facts, settings.businessHours) ?? "",
    "negocio.direccion": profile?.address?.trim() || "",
    "negocio.politica.cancelacion": policyBody(facts, "cancellation"),
    "negocio.politica.senas": policyBody(facts, "deposit"),
    "negocio.pagos": (profile?.paymentMethods ?? []).join(", ") || policyBody(facts, "payment"),
  };
}

/** Substitutes every `{{negocio.*}}` token `renderNegocioVars` knows against
 *  `values` — pure, so callers with the values already in hand (a preview,
 *  a test) don't need a tenant context. Unknown tokens are left as-is. */
export function renderNegocioVars(text: string, values: NegocioVars): string {
  return text.replace(/\{\{\s*(negocio\.[a-z.]+)\s*\}\}/gi, (match, rawName: string) => {
    const key = rawName.toLowerCase() as NegocioVariableName;
    return key in values ? values[key] : match;
  });
}
