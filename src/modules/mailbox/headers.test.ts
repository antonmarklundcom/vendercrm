import { describe, expect, it } from "vitest";
import { domainOf, normalizeMessageId, normalizeSubject, parseMessageIdList, replySubject } from "./headers";

describe("normalizeSubject", () => {
  it("strips stacked reply and forward prefixes in several languages", () => {
    expect(normalizeSubject("Re: RE: Fwd: Presupuesto")).toBe("presupuesto");
    expect(normalizeSubject("RV: Presupuesto")).toBe("presupuesto");
    expect(normalizeSubject("Sv: Offert")).toBe("offert");
    expect(normalizeSubject("AW: Angebot")).toBe("angebot");
    expect(normalizeSubject("Re[2]:  Hola   mundo ")).toBe("hola mundo");
    expect(normalizeSubject(undefined)).toBe("");
  });

  it("keeps words that merely start like a prefix", () => {
    expect(normalizeSubject("Reserva de mesa")).toBe("reserva de mesa");
  });
});

describe("message ids", () => {
  it("strips angle brackets", () => {
    expect(normalizeMessageId(" <abc@x.com> ")).toBe("abc@x.com");
    expect(normalizeMessageId("")).toBeNull();
  });

  it("parses a References header", () => {
    expect(parseMessageIdList("<a@x> <b@y>\r\n <a@x>")).toEqual(["a@x", "b@y"]);
    expect(parseMessageIdList(["<a@x>", "<c@z>"])).toEqual(["a@x", "c@z"]);
    expect(parseMessageIdList(null)).toEqual([]);
  });
});

describe("replySubject and domainOf", () => {
  it("adds Re: once", () => {
    expect(replySubject("Presupuesto")).toBe("Re: Presupuesto");
    expect(replySubject("RE: Presupuesto")).toBe("RE: Presupuesto");
  });

  it("lowercases the domain", () => {
    expect(domainOf("Ana@Tienda.COM.py")).toBe("tienda.com.py");
  });
});
