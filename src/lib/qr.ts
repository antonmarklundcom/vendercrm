import qrcode from "qrcode-generator";

// QR rendering (plan-booking.md §6.2 #4).
//
// Pure and free of the db client, like lib/phone.ts and lib/money.ts, so the
// output can be unit-tested without an environment — and so the same function
// serves a server component, a download button and (one day) a PDF.
//
// The encoder is `qrcode-generator`: no dependencies of its own, and it does
// the one part of this that should never be hand-written, Reed-Solomon error
// correction. Everything below is just turning its module grid into an SVG.

export type QrOptions = {
  /** Pixels per module. 8 gives a ~250px code for a typical booking URL. */
  scale?: number;
  /**
   * Quiet zone in modules. The spec says four, and scanners genuinely fail
   * below it — a QR printed flush against a poster border does not read.
   */
  margin?: number;
  /** Foreground; the background is always white, because scanners need it. */
  color?: string;
};

/**
 * Error correction level M: ~15% of the code can be damaged and still read.
 * These end up on window stickers and printed flyers that get scuffed, and
 * the extra size over L is a few modules.
 */
const ERROR_CORRECTION = "M";

/**
 * A QR code for `text`, as a standalone SVG document.
 *
 * One `<path>` of module rectangles rather than one `<rect>` per module: a
 * booking URL is ~600 modules, and 600 elements is a document that a browser
 * renders slowly and an `<img>` refuses to inline politely.
 */
export function qrSvg(text: string, options: QrOptions = {}): string {
  const scale = Math.max(1, Math.floor(options.scale ?? 8));
  const margin = Math.max(0, Math.floor(options.margin ?? 4));
  const color = options.color ?? "#000000";

  // Type 0 asks the encoder to pick the smallest version the data fits in.
  const qr = qrcode(0, ERROR_CORRECTION);
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const size = (count + margin * 2) * scale;

  let path = "";
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (!qr.isDark(row, column)) continue;
      const x = (column + margin) * scale;
      const y = (row + margin) * scale;
      path += `M${x} ${y}h${scale}v${scale}h-${scale}z`;
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"`,
    ` viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`,
    `<rect width="${size}" height="${size}" fill="#ffffff"/>`,
    `<path fill="${color}" d="${path}"/>`,
    `</svg>`,
  ].join("");
}

/**
 * The same SVG as a data URI, for an `<img src>` or a download link.
 *
 * base64 rather than percent-encoding: the payload contains `#` and quotes,
 * and a URL-encoded SVG data URI is the kind of thing that works everywhere
 * until one browser decides otherwise.
 */
export function qrDataUri(text: string, options: QrOptions = {}): string {
  const svg = qrSvg(text, options);
  const encoded =
    typeof btoa === "function"
      ? btoa(svg)
      : Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${encoded}`;
}
