import { describe, expect, it } from "vitest";
import { qrDataUri, qrSvg } from "./qr";

// The encoder itself is a dependency and is not re-tested here. What is worth
// pinning is the part this file owns: that the SVG is well-formed, sized as
// asked, and that the quiet zone a scanner needs actually survives.

describe("qrSvg", () => {
  const URL = "https://crm.vendercrm.com/b/mi-negocio/corte";

  it("renders one standalone SVG document with a white ground", () => {
    const svg = qrSvg(URL);
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    // A QR on a transparent background is unreadable on a dark page, and
    // these end up embedded in other people's documents.
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain("<path");
  });

  it("keeps the four-module quiet zone, which scanners need to lock on", () => {
    // Version 1 is 21 modules; whatever version this URL lands in, the drawn
    // area must be inset by exactly the margin on each side.
    const scale = 10;
    const margin = 4;
    const svg = qrSvg(URL, { scale, margin });
    const size = Number(svg.match(/width="(\d+)"/)![1]);

    // The finder pattern starts at the top-left of the code proper, so the
    // first module drawn is at exactly (margin * scale) on both axes.
    expect(svg).toContain(`M${margin * scale} ${margin * scale}h${scale}`);
    // And nothing is drawn past the far edge.
    const xs = [...svg.matchAll(/M(\d+) (\d+)h/g)].map((match) => Number(match[1]));
    expect(Math.max(...xs)).toBeLessThanOrEqual(size - margin * scale - scale);
  });

  it("scales the whole code, not just the modules", () => {
    const small = Number(qrSvg(URL, { scale: 4 }).match(/width="(\d+)"/)![1]);
    const large = Number(qrSvg(URL, { scale: 8 }).match(/width="(\d+)"/)![1]);
    expect(large).toBe(small * 2);
  });

  it("grows a version rather than truncating a long link", () => {
    const short = qrSvg("https://x.co/a");
    const long = qrSvg(`${URL}?utm_source=${"a".repeat(300)}`);
    const sizeOf = (svg: string) => Number(svg.match(/width="(\d+)"/)![1]);
    expect(sizeOf(long)).toBeGreaterThan(sizeOf(short));
  });

  it("encodes a wa.me link, prefilled message and all", () => {
    // The other half of what the booking-type page offers, and the one whose
    // characters (?, =, %) are most likely to trip an encoder.
    expect(() => qrSvg("https://wa.me/595981123456?text=Hola%2C%20quiero%20un%20turno")).not.toThrow();
  });

  it("is deterministic, so a reprinted sticker is the same sticker", () => {
    expect(qrSvg(URL)).toBe(qrSvg(URL));
  });
});

describe("qrDataUri", () => {
  it("wraps the same SVG as base64, ready for an img src or a download", () => {
    const uri = qrDataUri("https://wa.me/595981123456");
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const decoded = Buffer.from(uri.split(",")[1], "base64").toString("utf8");
    expect(decoded).toBe(qrSvg("https://wa.me/595981123456"));
  });
});
