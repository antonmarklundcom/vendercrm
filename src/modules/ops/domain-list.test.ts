import { describe, expect, it } from "vitest";
import { displayNameFor, parseDomainList } from "./domain-list";

// What the owner pastes into /claude-ops is whatever he has at hand: the
// domains.txt file, a column copied from a spreadsheet, or URLs from a
// browser. All of it has to come out as the same clean domain list.

describe("parseDomainList", () => {
  it("reads the domains.txt format, names optional", () => {
    const parsed = parseDomainList(
      "# comment\n\ndentista.com.py, Dentista Paraguay\ngruas.com.py\n",
    );
    expect(parsed.entries).toEqual([
      { domain: "dentista.com.py", name: "Dentista Paraguay" },
      { domain: "gruas.com.py", name: "Gruas" },
    ]);
    expect(parsed.invalid).toEqual([]);
  });

  it("reduces URLs to the host and accepts tab-separated spreadsheet rows", () => {
    const parsed = parseDomainList(
      "https://www.Vino.com.py/contacto?x=1\nrentparaguay.com\tRent Paraguay",
    );
    expect(parsed.entries).toEqual([
      { domain: "vino.com.py", name: "Vino" },
      { domain: "rentparaguay.com", name: "Rent Paraguay" },
    ]);
  });

  it("reports lines that are not domains and keeps only the first duplicate", () => {
    const parsed = parseDomainList("not a domain\nmoto.com.py\nMOTO.com.py, Otra");
    expect(parsed.invalid).toEqual(["not a domain"]);
    expect(parsed.duplicates).toEqual(["moto.com.py"]);
    expect(parsed.entries).toHaveLength(1);
  });

  it("derives a readable name from the first label", () => {
    expect(displayNameFor("redes-sociales.com.py")).toBe("Redes sociales");
  });
});
