import { describe, expect, it } from "vitest";
import messages from "../../messages/es.json";
import en from "../../messages/en.json";
import sv from "../../messages/sv.json";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";

// Guards the Spanish copy file itself (PLAN.md §10 1H: "pass through UI for
// Spanish copy consistency"). These are the three ways the file has actually
// broken so far, not hypothetical ones.

// Arrays are part of the shape since §5.2.5: the webhook connection guide
// stores each platform's steps as an ordered list, read with t.raw(). They
// flatten by index so every string in them is still covered by the guards
// below — an empty step or a stray "§" in one must fail here too.
type MessageNode = string | MessageNode[] | { [key: string]: MessageNode };

function flatten(tree: MessageNode, prefix = ""): Array<[string, string]> {
  if (typeof tree === "string") return prefix ? [[prefix, tree]] : [];
  const entries: Array<[string, MessageNode]> = Array.isArray(tree)
    ? tree.map((value, index) => [`${prefix}[${index}]`, value])
    : Object.entries(tree).map(([key, value]) => [prefix ? `${prefix}.${key}` : key, value]);

  return entries.flatMap(([path, value]) => flatten(value, path));
}

const entries = flatten(messages as MessageNode);

describe("messages/es.json", () => {
  it("has messages", () => {
    expect(entries.length).toBeGreaterThan(100);
  });

  it("has no empty or whitespace-only copy", () => {
    const blank = entries.filter(([, value]) => value.trim() === "");
    expect(blank).toEqual([]);
  });

  it("leaks no internal spec references into user-facing copy", () => {
    // A "(conexión manual — PLAN.md §6.2)" once shipped in the WhatsApp
    // connect help text. The spec is for the repo, not the customer.
    const leaks = entries.filter(([, value]) => /PLAN\.md|§/.test(value));
    expect(leaks).toEqual([]);
  });

  it("uses no double-brace placeholders", () => {
    // next-intl parses values as ICU MessageFormat, where `{name}` is a
    // placeholder and `{{name}}` is a syntax error. Merge tags shown to the
    // user must be passed in as an ICU argument instead.
    const doubled = entries.filter(([, value]) => value.includes("{{"));
    expect(doubled).toEqual([]);
  });
});

// Key parity across locales (PLAN.md §13 H5 #3). `es` is the reference: a key
// added there and forgotten in en/sv would render as the raw key path in the
// UI, which is exactly the failure a Spanish-speaking author can't see. This
// is the guard that makes the other locales maintainable rather than a
// snapshot that rots.
const LOCALES: Record<string, MessageNode> = {
  en: en as MessageNode,
  sv: sv as MessageNode,
};

const referenceKeys = new Set(entries.map(([key]) => key));

describe("locale key parity", () => {
  it("ships a messages file for every supported locale", () => {
    expect(Object.keys(LOCALES).concat("es").sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  for (const [locale, tree] of Object.entries(LOCALES)) {
    const localeEntries = flatten(tree);
    const localeKeys = new Set(localeEntries.map(([key]) => key));

    it(`${locale} has every key es.json has`, () => {
      expect([...referenceKeys].filter((key) => !localeKeys.has(key))).toEqual([]);
    });

    it(`${locale} has no key es.json lacks`, () => {
      expect([...localeKeys].filter((key) => !referenceKeys.has(key))).toEqual([]);
    });

    it(`${locale} has no empty or whitespace-only copy`, () => {
      expect(localeEntries.filter(([, value]) => value.trim() === "")).toEqual([]);
    });

    it(`${locale} uses no double-brace placeholders`, () => {
      expect(localeEntries.filter(([, value]) => value.includes("{{"))).toEqual([]);
    });
  }
});

// Shape guard for the webhook connection guide (PLAN.md §5.2.5). /sites reads
// `hookGuide.platforms` whole with t.raw() and hands it straight to the client
// component, so this array is a contract, not just copy: an entry missing an
// id, a label or a non-empty steps list renders a broken tab, and ids that
// drift between locales change which platform a visitor sees.
type Platform = { id: string; label: string; steps: string[] };

function platformsOf(tree: MessageNode): Platform[] {
  const guide = (tree as { app: { sites: { hookGuide: { platforms: unknown } } } }).app.sites
    .hookGuide.platforms;
  expect(Array.isArray(guide)).toBe(true);
  return guide as Platform[];
}

describe("hookGuide.platforms", () => {
  const reference = platformsOf(messages as MessageNode);

  it("ships at least one platform", () => {
    expect(reference.length).toBeGreaterThan(0);
  });

  for (const [locale, tree] of Object.entries({ es: messages as MessageNode, ...LOCALES })) {
    const platforms = platformsOf(tree);

    it(`${locale} gives every platform an id, a label and steps`, () => {
      expect(
        platforms.filter(
          (platform) =>
            typeof platform?.id !== "string" ||
            typeof platform?.label !== "string" ||
            !Array.isArray(platform?.steps) ||
            platform.steps.length === 0 ||
            platform.steps.some((step) => typeof step !== "string"),
        ),
      ).toEqual([]);
    });

    it(`${locale} lists the same platform ids, in the same order`, () => {
      expect(platforms.map((platform) => platform.id)).toEqual(
        reference.map((platform) => platform.id),
      );
    });
  }
});

// Voseo in customer-facing Spanish (plan-booking.md §1, §6.2 #2).
//
// The reader of everything under `public.*` is the customer of a Paraguayan
// business, not the CRM's user, and "elige un horario" reads to them the way
// "kindly select a timeslot" reads to an English speaker: correct, and
// written by somebody else's software. Admin copy is exempt — it is the
// tenant's own screen and neutral Spanish is fine there.
//
// A blocklist of the tuteo imperatives and present-tense forms these strings
// actually reach for, rather than an attempt to conjugate Spanish: the point
// is to fail when somebody adds "Selecciona una fecha", not to be a grammar
// checker.
describe("customer-facing Spanish uses voseo", () => {
  // Whole words only: "Enviar" is an infinitive on a button and perfectly
  // fine; "envía" is the tuteo imperative that is not.
  const TUTEO = [
    "elige",
    "elija",
    "selecciona",
    "escribe",
    "env[íi]a",
    "ingresa",
    "confirma",
    "descarga",
    "revisa",
    "espera",
    "intenta",
    "vuelve",
    "recuerda",
    // Accent and all: "contactanos" and "dejanos" are the voseo imperatives
    // and are correct — it is "contáctanos" and "déjanos" that are not.
    "cuéntanos",
    "contáctanos",
    "déjanos",
    "compártelo",
    "tienes",
    "puedes",
    "debes",
    "quieres",
    "necesitas",
    "prefieres",
    "deseas",
  ].map((form) => new RegExp(`\\b${form}\\b`, "i"));

  const strings: Array<[string, string]> = [];
  const walk = (node: unknown, path: string[]) => {
    if (typeof node === "string") {
      strings.push([path.join("."), node]);
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        walk(value, [...path, key]);
      }
    }
  };
  walk((messages as Record<string, unknown>).public, ["public"]);

  it("finds the strings it is supposed to be checking", () => {
    expect(strings.length).toBeGreaterThan(20);
  });

  it("has no tuteo left anywhere a customer can read", () => {
    const offenders = strings.filter(([, value]) =>
      TUTEO.some((form) => form.test(value)),
    );
    expect(offenders).toEqual([]);
  });
});
