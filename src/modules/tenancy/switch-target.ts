import type { TenantRole } from "./context";

// Where the business switcher lands you (PLAN.md §3.1).
//
// "Stay on the same page" is the right instinct — going from one business's
// pipeline to the other's pipeline is the whole point — but it is only safe
// for *list* routes. Two things make a naive "keep the URL" wrong:
//
//  1. **Detail routes carry a ULID belonging to the business you just left.**
//     `/contacts/01J.../` after a switch is, at best, a 404. At worst it is a
//     cross-tenant probe: "does this id exist over there?" is a question the
//     UI must never let anyone ask by clicking. So the id is dropped and you
//     land on that section's list.
//
//  2. **Your role can change with the business.** Admin at one, agent at
//     another (§3.1) — so an admin-only section has to fall back to the
//     dashboard when you arrive as an agent, or you land on a page whose
//     every button throws.
//
// Pure and side-effect free on purpose: it is the piece worth testing
// exhaustively, and it runs before anything is written.

/** Sections an agent may not enter (§3.2, mirrored by the nav in the layout). */
const ADMIN_ONLY = ["/automations", "/forms", "/sites", "/whatsapp", "/users", "/settings"];

/** Where each section's list lives. A path under one of these keeps the
 * section and loses everything after it. */
const SECTIONS = [
  "/contacts",
  "/pipeline",
  "/inbox",
  "/quotes",
  "/documents",
  "/products",
  "/automations",
  "/forms",
  "/sites",
  "/whatsapp",
  "/users",
  "/settings",
  "/dashboard",
  // Cross-business already, so switching from it keeps you on it.
  "/businesses",
];

export const SWITCH_FALLBACK = "/dashboard";

/**
 * The path to land on after switching into a business where the user's role
 * is `role`.
 *
 * Anything unrecognised falls back to the dashboard rather than being passed
 * through: `pathname` arrives from a form field, and a permissive resolver
 * here would turn the switcher into an open redirect.
 */
export function resolveSwitchTarget(
  pathname: string | null | undefined,
  role: TenantRole,
): string {
  if (!pathname || !pathname.startsWith("/")) return SWITCH_FALLBACK;

  // A form field, not a router value: strip anything that could carry it
  // somewhere else. `//evil.com` is a protocol-relative URL, and a query
  // string is full of the old business's tag and user ids anyway — filters
  // never survive a switch.
  if (pathname.startsWith("//")) return SWITCH_FALLBACK;
  const path = pathname.split(/[?#]/)[0];

  const section = SECTIONS.find(
    (candidate) => path === candidate || path.startsWith(`${candidate}/`),
  );
  if (!section) return SWITCH_FALLBACK;

  if (role !== "admin" && ADMIN_ONLY.includes(section)) return SWITCH_FALLBACK;

  // The section list, never the sub-page: `/contacts/01J...` and
  // `/contacts/import` and `/pipeline/etapas` all become the section itself.
  // Keeping a sub-page would either 404 or, for the id routes, answer
  // "does this record exist in the other business?".
  return section;
}
