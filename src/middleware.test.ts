import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAppHost, isPublicPath, resolveHostRedirect } from "./middleware";

// The auth allowlist fails closed, which is the right default but makes an
// omission silent in a confusing way: a missing public prefix doesn't look
// like an auth bug, it looks like WhatsApp not delivering attachments or a
// customer's quote link being broken. 1Q shipped with /d/ missing and only a
// real HTTP request caught it — hence these.

describe("isPublicPath", () => {
  it("allows the customer-facing document surfaces, including the PDF Meta fetches", () => {
    expect(isPublicPath("/q/abc123")).toBe(true);
    expect(isPublicPath("/q/abc123/pdf")).toBe(true);
    expect(isPublicPath("/d/abc123")).toBe(true);
    expect(isPublicPath("/d/abc123/pdf")).toBe(true);
  });

  it("allows hosted forms, the attribution snippet, auth pages and api routes", () => {
    expect(isPublicPath("/f/acme/contacto")).toBe(true);
    expect(isPublicPath("/vc-attribution.js")).toBe(true);
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/accept-invite/tok")).toBe(true);
    expect(isPublicPath("/forgot-password")).toBe(true);
    expect(isPublicPath("/reset-password")).toBe(true);
    expect(isPublicPath("/api/webhooks/whatsapp")).toBe(true);
    expect(isPublicPath("/")).toBe(true);
  });

  it("still protects the tenant app and the superadmin console", () => {
    for (const path of [
      "/dashboard",
      "/contacts",
      "/inbox",
      "/quotes",
      "/documents",
      "/settings",
      "/tenants",
      "/plans",
      "/automations",
    ]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });

  it("allows the public booking pages and the embedded chat widget", () => {
    // Both of these shipped *missing* from the allowlist. The failure is the
    // confusing kind this whole suite exists for: a customer opening the
    // manage link a business WhatsApp'd them got the CRM login page, and the
    // chat widget iframe 302'd on every third-party site that embedded it.
    expect(isPublicPath("/b/barberia-central/corte")).toBe(true);
    expect(isPublicPath("/b/g/tok123")).toBe(true);
    expect(isPublicPath("/w/wk_abc123")).toBe(true);
  });

  it("does not treat a lookalike prefix as public", () => {
    // "/documents" must not be matched by the "/d/" prefix.
    expect(isPublicPath("/documents")).toBe(false);
    expect(isPublicPath("/deals")).toBe(false);
  });
});

// Host awareness (MARKETING_SITE_PLAN.md §4). One app answers two products
// on two hostnames, so "is this path public" stopped being a property of the
// path alone. The failure modes are asymmetric and both bad: too strict on
// the apex means the marketing site 302s visitors to a CRM login page, too
// loose on crm.* means the CRM is wide open. Hence a test per direction.

describe("isPublicPath, host-aware", () => {
  const apex = "clientes.com.py";
  const crm = "crm.clientes.com.py";

  it("keeps the strict allowlist on the crm host", () => {
    expect(isPublicPath("/dashboard", crm)).toBe(false);
    expect(isPublicPath("/pipeline", crm)).toBe(false);
    expect(isPublicPath("/tenants", crm)).toBe(false);
    expect(isPublicPath("/metodo", crm)).toBe(false);
    expect(isPublicPath("/login", crm)).toBe(true);
    expect(isPublicPath("/", crm)).toBe(true);
  });

  it("opens every marketing route on the apex host", () => {
    for (const path of ["/", "/metodo", "/contacto", "/nosotros", "/soluciones/clinicas"]) {
      expect(isPublicPath(path, apex)).toBe(true);
    }
  });

  it("does not let a marketing host blanket-open a path the app protects", () => {
    // A CRM path reached on the apex is public only in the sense that the
    // middleware lets it through — resolveHostRedirect below has already
    // bounced it to crm.* by the time this matters. What must never happen
    // is the reverse: the apex rule leaking onto the crm host.
    expect(isPublicPath("/dashboard", crm)).toBe(false);
    expect(isPublicPath("/dashboard", `www.${apex}`)).toBe(true);
  });

  it("routes /api through the allowlist on every host, never the host blanket", () => {
    // Same API on both hostnames; it must not become public *because of* the
    // host, only because "/api" is on the allowlist.
    expect(isPublicPath("/api/v1/leads", apex)).toBe(true);
    expect(isPublicPath("/api/v1/leads", crm)).toBe(true);
  });

  it("treats localhost and preview hostnames as marketing hosts", () => {
    // Matches the host check page.tsx has always used: only crm.* is the app.
    expect(isPublicPath("/metodo", "localhost:3000")).toBe(true);
    expect(isPublicPath("/dashboard", "srv123.hostingersite.com")).toBe(true);
  });

  it("behaves exactly like the old allowlist when no host is passed", () => {
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isPublicPath("/login")).toBe(true);
  });
});

describe("isAppHost", () => {
  it("recognises only the crm subdomain", () => {
    expect(isAppHost("crm.clientes.com.py")).toBe(true);
    expect(isAppHost("crm.clientes.com.py:3000")).toBe(true);
    expect(isAppHost("clientes.com.py")).toBe(false);
    expect(isAppHost("www.clientes.com.py")).toBe(false);
    expect(isAppHost("localhost:3000")).toBe(false);
    expect(isAppHost(null)).toBe(false);
  });
});

describe("resolveHostRedirect", () => {
  it("301s www to the apex, preserving path and query", () => {
    expect(resolveHostRedirect("www.clientes.com.py", "/metodo", "?utm_source=ads")).toEqual({
      url: "https://clientes.com.py/metodo?utm_source=ads",
      status: 301,
    });
  });

  it("sends stale app bookmarks from the apex to the crm host", () => {
    for (const path of ["/dashboard", "/login", "/pipeline", "/contacts/abc123"]) {
      expect(resolveHostRedirect("clientes.com.py", path)).toEqual({
        url: `https://crm.clientes.com.py${path}`,
        status: 307,
      });
    }
  });

  it("leaves marketing paths on the apex alone", () => {
    for (const path of ["/", "/metodo", "/contacto", "/nosotros"]) {
      expect(resolveHostRedirect("clientes.com.py", path)).toBeNull();
    }
  });

  it("keeps shared customer links and the API on whichever host they were opened", () => {
    // A quote link sent over WhatsApp, or a site posting its leads, must not
    // be bounced to another hostname mid-request.
    for (const path of [
      "/api/v1/leads",
      "/q/tok",
      "/d/tok/pdf",
      "/f/acme/contacto",
      "/b/acme/corte",
      "/b/g/tok",
      "/w/wk_abc",
    ]) {
      expect(resolveHostRedirect("clientes.com.py", path)).toBeNull();
    }
  });

  it("does not match an app prefix that is only a lookalike", () => {
    // "/settings" is an app path; "/settings-de-privacidad" would be a
    // marketing URL and must not be redirected off the apex.
    expect(resolveHostRedirect("clientes.com.py", "/settings-de-privacidad")).toBeNull();
    expect(resolveHostRedirect("clientes.com.py", "/planes")).toBeNull();
  });

  it("never redirects development or preview hosts to production", () => {
    expect(resolveHostRedirect("localhost:3000", "/dashboard")).toBeNull();
    expect(resolveHostRedirect("srv123.hostingersite.com", "/login")).toBeNull();
    expect(resolveHostRedirect(null, "/dashboard")).toBeNull();
  });

  it("leaves the crm host untouched", () => {
    expect(resolveHostRedirect("crm.clientes.com.py", "/dashboard")).toBeNull();
    expect(resolveHostRedirect("crm.clientes.com.py", "/")).toBeNull();
  });
});

// The allowlist is a hand-maintained copy of a fact the filesystem already
// knows: everything under the (public) route group is, by construction,
// public. Every entry that has ever been forgotten (/d/, then /b/ and /w/)
// was forgotten the same way — a route group was added and the list wasn't.
// So the list is checked against the directory rather than against a
// developer's memory, and the next omission fails here instead of in
// production.
describe("the (public) route group is fully allowlisted", () => {
  const publicGroup = path.join(__dirname, "app", "(public)");

  const segments = readdirSync(publicGroup, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    // Route groups and dynamic segments are not URL segments of their own.
    .filter((entry) => !entry.name.startsWith("(") && !entry.name.startsWith("["))
    .map((entry) => entry.name);

  it("finds the segments it is supposed to be checking", () => {
    // Guards against the scan silently passing because it found nothing.
    expect(segments.length).toBeGreaterThan(0);
  });

  it.each(segments)("treats /%s/ as public", (segment) => {
    expect(isPublicPath(`/${segment}/anything`)).toBe(true);
  });
});
