import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { APEX_HOST, APP_HOST } from "@/lib/config/hosts";

// Fast, edge-safe gate: presence of a session cookie only (no DB call, no
// tenant context — mysql2 isn't edge-runtime safe). Real tenant-context
// resolution, role checks, and the suspension/expiry access-status check
// (grace/locked) happen server-side in the (app) and (superadmin) layouts,
// which run in the Node.js runtime and can reach the tenancy module.
// Known public surface (PLAN.md §2.2 `(public)`/`(auth)` route groups +
// api/webhooks). Route groups like (app)/(superadmin) don't add a URL
// prefix, so we can't matcher-match on "/app/*" — instead this list is
// checked in code against the actual pathname, failing closed (protect)
// for anything not explicitly listed here.
export const PUBLIC_PREFIXES = [
  "/login",
  "/accept-invite",
  "/forgot-password",
  "/reset-password",
  "/api",
  "/f/",
  "/q/",
  // Public nota de venta view + PDF (§10 1Q). The /pdf path in particular
  // is fetched by *Meta* when delivering the document over WhatsApp, so a
  // redirect to /login here doesn't look like an auth bug — it looks like
  // WhatsApp silently not delivering attachments.
  "/d/",
  // Public receipt view + PDF (§15.2, §15.8 P6) — same reasoning as /q/ and
  // /d/: a rep hands this link to a customer, or WhatsApp fetches the /pdf
  // path itself, and neither has a session here.
  "/r/",
  // The public booking page (/b/[tenantSlug]/[typeSlug]) and the customer's
  // own manage/cancel link (/b/g/[token]). Both shipped behind the auth gate
  // — a customer opening the link a business sent them landed on a CRM login
  // page, which reads as "the booking system is broken", not as an auth bug.
  "/b/",
  // The embedded chat widget's iframe (/w/[widgetKey]). Loaded by visitors
  // of *other people's* websites, who by definition have no session here.
  "/w/",
  // The email unsubscribe link (/u/[token], §15.1, §15.8 P4). Clicked from a
  // customer's own mail client, which by definition has no session here —
  // same reasoning as /q/, /d/, /b/ above.
  "/u/",
];

// Exact public paths, kept separate from the prefixes above so this stays a
// narrow allowlist rather than "anything under /vc-*". The attribution
// snippet (§5.1) is loaded by connected sites' visitors, who by definition
// have no session here — without this it would be redirected to /login.
// Every one of these is a script loaded by a visitor to *someone else's*
// site, who has no session here — so a redirect to /login is not an auth
// failure but a widget that silently never appears. `w.js` was missing until
// the booking widget was built beside it; the test below now checks this
// list against `public/` rather than against memory.
// `/sw.js` is here for a different reason than the embed loaders: it is only
// ever registered by a signed-in browser, so the *first* fetch always carries
// a session. The browser re-fetches the worker script on its own schedule
// though, and a session that has since lapsed would answer that with a 307 to
// /login — which a browser reads as "this worker script is invalid" and
// responds to by tearing the registration down. Push would then stop, silently
// and permanently, for anyone who left the app closed over a weekend. The
// script itself is public code with no tenant data in it (PLAN.md §15.5 J2).
export const PUBLIC_EXACT = ["/vc-attribution.js", "/w.js", "/b.js", "/sw.js"];

// One Node app answers both the apex marketing domain and the crm.* app
// subdomain (parked domain, shared document root — see hPanel Domains).
// The host, not the path, decides which product the visitor is looking at.
const APP_HOST_PREFIX = "crm.";

/**
 * True for the CRM subdomain, false for the apex marketing domain, `www.`,
 * Hostinger's preview hostname and localhost. Host headers carry a port in
 * development, which is why this is a prefix test and not an equality one.
 */
export function isAppHost(host: string | null): boolean {
  return (host ?? "").startsWith(APP_HOST_PREFIX);
}

/**
 * Extracted and exported so the allowlist is unit-testable without booting
 * Next. Every public surface that an *external* system fetches (Meta pulling
 * a PDF, a site visitor loading a form) fails closed if it's missing from
 * the lists above, and fails in a way that looks like a different bug —
 * so it gets a test rather than trust.
 *
 * `host` makes this host-aware (MARKETING_SITE_PLAN.md §4): the marketing
 * site is a public brochure, so on any non-`crm.*` host everything is public
 * and there is no allowlist to forget an entry from. `/api` is the one
 * exception — the API is the same API on every host, so it keeps falling
 * through to the allowlist below rather than being blanket-opened by the
 * host. On `crm.*` the strict allowlist is unchanged.
 *
 * Called with no host (as the existing tests do) it behaves exactly as it
 * always did: the strict allowlist.
 */
export function isPublicPath(pathname: string, host?: string | null): boolean {
  if (host !== undefined && !isAppHost(host) && !pathname.startsWith("/api")) {
    return true;
  }

  return (
    pathname === "/" ||
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  );
}

// Paths that only ever mean something inside the CRM. Reached on the apex
// domain they're a stale bookmark or a mistyped host, not a marketing URL —
// so they redirect to the same path on crm.* rather than 404ing into the
// marketing site. Kept as prefixes so /contacts/abc and /quotes/1/pdf travel
// with their parents. Deliberately excludes /api (same API on every host)
// and /f/, /q/, /d/ (customer-facing links that must resolve wherever they
// were shared from).
export const APP_PATH_PREFIXES = [
  "/dashboard",
  "/pipeline",
  "/contacts",
  "/inbox",
  "/quotes",
  "/documents",
  "/products",
  "/forms",
  "/sites",
  "/users",
  "/whatsapp",
  "/automations",
  "/settings",
  "/tenants",
  "/plans",
  "/whatsapp-health",
  "/audit",
  "/login",
  "/accept-invite",
  "/forgot-password",
  "/reset-password",
];

function isAppPath(pathname: string): boolean {
  return APP_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

// The crm.* host must never be indexed (MARKETING_SITE_PLAN.md §1.2): every
// URL under it is a login wall or an unguessable customer link. app/robots.ts
// is static and can't see the host, so the middleware answers /robots.txt for
// the app host itself. Exported as a pure function so it's unit-testable the
// same way the allowlist is.
export const CRM_ROBOTS_BODY = "User-agent: *\nDisallow: /\n";

export function crmRobotsBody(host: string | null, pathname: string): string | null {
  return isAppHost(host) && pathname === "/robots.txt" ? CRM_ROBOTS_BODY : null;
}

export type HostRedirect = { url: string; status: 301 | 307 };

/**
 * Canonical-host and wrong-host handling (MARKETING_SITE_PLAN.md §4),
 * resolved from the request host alone so it's unit-testable.
 *
 * Only the two real public hostnames are rewritten. localhost, Hostinger's
 * preview hostname and any future staging host fall through untouched —
 * otherwise `localhost:3000/dashboard` would bounce a developer to
 * production.
 */
export function resolveHostRedirect(
  host: string | null,
  pathname: string,
  search = "",
): HostRedirect | null {
  if (!host) return null;

  // 301 www → apex. Permanent: the canonical host is a locked decision, and
  // link equity should consolidate on the apex.
  if (host === `www.${APEX_HOST}`) {
    return { url: `https://${APEX_HOST}${pathname}${search}`, status: 301 };
  }

  // Apex → crm.* for app-only paths. 307 rather than 308: browsers cache
  // permanent redirects aggressively, and which paths belong to the app is
  // the kind of list that changes.
  if (host === APEX_HOST && isAppPath(pathname)) {
    return { url: `https://${APP_HOST}${pathname}${search}`, status: 307 };
  }

  return null;
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = request.headers.get("host");

  // Before the auth gate: a wrong-host request should land on the right host
  // rather than be redirected to a login page on the wrong one.
  const hostRedirect = resolveHostRedirect(host, pathname, search);
  if (hostRedirect) {
    return NextResponse.redirect(hostRedirect.url, hostRedirect.status);
  }

  const robots = crmRobotsBody(host, pathname);
  if (robots) {
    return new NextResponse(robots, {
      headers: { "content-type": "text/plain" },
    });
  }

  if (isPublicPath(pathname, host)) {
    return withRobotsHeader(NextResponse.next(), host);
  }

  const hasSession = !!getSessionCookie(request);
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return withRobotsHeader(NextResponse.next(), host);
}

// Belt to the robots.txt braces: every page served from the crm host also
// carries a noindex header, so a page that slips through a future allowlist
// change still never lands in an index.
function withRobotsHeader(response: NextResponse, host: string | null): NextResponse {
  if (isAppHost(host)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
