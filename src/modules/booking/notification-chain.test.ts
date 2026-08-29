import { describe, expect, it } from "vitest";
import { channelChain, selectChannel } from "./notification-chain";
import {
  BOOKING_TEMPLATES,
  buildEmail,
  buildFreeFormText,
  oneLine,
  templateSendComponents,
  templateSubmissionPayload,
  type BookingNotificationVars,
} from "./notification-templates";
import { BOOKING_NOTIFICATION_KINDS } from "./notification-chain";

// The reason this file exists: before the chain, a booking reminder was a
// single free-form WhatsApp send that skipped whenever the 24h window was
// shut — i.e. for every customer who booked on the website and had never
// messaged the business. Each branch below is one of the four states a real
// tenant is in, and the wrong pick in any of them means somebody is not told
// about their appointment.

const availability = (over: Partial<Parameters<typeof channelChain>[0]> = {}) => ({
  whatsappReady: true,
  templateApproved: true,
  windowOpen: true,
  hasEmail: true,
  ...over,
});

describe("channel selection", () => {
  it("prefers the approved template, even when the 24h window happens to be open", () => {
    // The window is luck; the template is the thing that works for the next
    // customer too, and Meta charges the same either way.
    expect(selectChannel(availability())).toBe("wa_template");
  });

  it("falls back to free-form while the template is still in review", () => {
    expect(selectChannel(availability({ templateApproved: false }))).toBe("wa_freeform");
  });

  it("falls back to email when there is no template and the window is closed", () => {
    // The common state of a tenant on day one: WhatsApp connected, templates
    // submitted, Meta still reviewing.
    expect(
      selectChannel(availability({ templateApproved: false, windowOpen: false })),
    ).toBe("email");
  });

  it("reports 'none' rather than pretending, when nothing can reach the customer", () => {
    expect(
      selectChannel(
        availability({ templateApproved: false, windowOpen: false, hasEmail: false }),
      ),
    ).toBe("none");
    expect(
      selectChannel(availability({ whatsappReady: false, hasEmail: false })),
    ).toBe("none");
  });

  it("keeps email behind WhatsApp when WhatsApp can be used", () => {
    expect(channelChain(availability())).toEqual(["wa_template", "wa_freeform", "email"]);
  });

  it("offers email alone when the tenant has no WhatsApp account connected", () => {
    // whatsappReady false must suppress *both* WhatsApp rungs — a template
    // send with no account is a guaranteed throw, not a fallback.
    expect(channelChain(availability({ whatsappReady: false }))).toEqual(["email"]);
  });

  it("never returns an empty chain, so a caller cannot silently do nothing", () => {
    for (const flags of [
      {},
      { templateApproved: false },
      { windowOpen: false },
      { hasEmail: false },
      { whatsappReady: false, templateApproved: false, windowOpen: false, hasEmail: false },
    ]) {
      expect(channelChain(availability(flags)).length).toBeGreaterThan(0);
    }
  });
});

const vars: BookingNotificationVars = {
  contactName: "María",
  businessName: "Barbería Central",
  serviceName: "Corte de pelo",
  when: "12/03/2026 15:30",
  manageUrl: "https://crm.clientes.com.py/b/g/tok123",
  location: "Palma 123, Asunción",
  depositAmount: "₲ 50.000",
  depositInstructions: "Banco Itaú\ncta. 12345678\na nombre de Juan Pérez",
  reviewUrl: "https://g.page/r/example/review",
};

describe("template definitions", () => {
  it("fills every declared placeholder, for every kind", () => {
    for (const kind of BOOKING_NOTIFICATION_KINDS) {
      const definition = BOOKING_TEMPLATES[kind];
      const placeholders = [...definition.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]);
      const values = definition.variables(vars);
      // Meta binds body parameters by position: a definition whose body has
      // five placeholders and whose builder returns four gets an approved
      // template that fails at send time with error 132000.
      expect(new Set(placeholders).size).toBe(values.length);
      expect(placeholders).toEqual(values.map((_, index) => String(index + 1)));
    }
  });

  it("submits an example value per placeholder, as Meta's review requires", () => {
    for (const kind of BOOKING_NOTIFICATION_KINDS) {
      const payload = templateSubmissionPayload(kind);
      const body = payload.components[0] as { text: string; example: { body_text: string[][] } };
      const placeholders = new Set([...body.text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]));
      expect(body.example.body_text[0].length).toBe(placeholders.size);
    }
  });

  it("flattens newlines out of variable values", () => {
    // Meta rejects a parameter containing a newline at send time, and the
    // tenant-authored transfer instructions are exactly where one comes from.
    const components = templateSendComponents("deposit_request", vars) as Array<{
      parameters: Array<{ text: string }>;
    }>;
    for (const parameter of components[0].parameters) {
      expect(parameter.text).not.toMatch(/[\n\t]/);
    }
    expect(oneLine("a\n b  c")).toBe("a b c");
  });

  it("names every template distinctly, in the app's own namespace", () => {
    const names = BOOKING_NOTIFICATION_KINDS.map((kind) => BOOKING_TEMPLATES[kind].name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.startsWith("vc_")).toBe(true);
  });
});

describe("the fallback rungs say the same thing", () => {
  it("names the service, the business and the time in every kind", () => {
    for (const kind of BOOKING_NOTIFICATION_KINDS) {
      const text = buildFreeFormText(kind, vars);
      expect(text).toContain(vars.contactName);
      expect(text).toContain(vars.businessName);
      if (kind !== "review_request") expect(text).toContain(vars.when);
    }
  });

  it("does not offer a manage link on a cancellation", () => {
    // There is nothing left to manage, and the link renders a cancelled
    // booking — inviting the customer to it reads like the cancel failed.
    expect(buildFreeFormText("cancellation", vars)).not.toContain(vars.manageUrl);
    expect(buildFreeFormText("confirmation", vars)).toContain(vars.manageUrl);
  });

  it("carries the seña amount and the transfer details on a deposit request", () => {
    const text = buildFreeFormText("deposit_request", vars);
    expect(text).toContain("₲ 50.000");
    expect(text).toContain("Banco Itaú");
  });

  it("escapes the email rung, which is the only one rendering HTML", () => {
    const email = buildEmail("confirmation", { ...vars, businessName: 'Bar <b>"X"</b>' });
    expect(email.html).toContain("&lt;b&gt;");
    expect(email.html).not.toContain("<b>");
    expect(email.subject).toContain('Bar <b>"X"</b>');
  });

  it("writes customer copy in voseo, not tuteo", () => {
    // The customer of a Paraguayan business is the reader (plan-booking.md
    // §1); "puedes/necesitas" here would be a tell that the copy was written
    // for a different market.
    const all = BOOKING_NOTIFICATION_KINDS.map((kind) => buildFreeFormText(kind, vars))
      .concat(BOOKING_NOTIFICATION_KINDS.map((kind) => BOOKING_TEMPLATES[kind].body))
      .join(" ");
    expect(all).not.toMatch(/\b(puedes|necesitas|tienes|quieres|avísanos|entra aquí)\b/i);
  });
});
