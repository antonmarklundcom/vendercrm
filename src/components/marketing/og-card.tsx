import { ImageResponse } from "next/og";

// Shared renderer for the marketing og-images (seo-web-builds §6: links get
// shared in WhatsApp, where the preview card is the ad). Palette is the
// marketing token set from globals.css — ink field, on-ink accent — rendered
// with the library's built-in face because next/og can't reach next/font; the
// card leans on the same eyebrow + oversized-statement language as the site
// so it still reads as the brand.

export const OG_SIZE = { width: 1200, height: 630 };

const INK = "#0C1A20";
const BASE = "#F1F4F5";
const ACCENT_ON_INK = "#4FB4D0";

export function brandCard(eyebrow: string, title: string, sub: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: INK,
          padding: "72px 80px",
          borderLeft: `14px solid ${ACCENT_ON_INK}`,
        }}
      >
        <div
          style={{
            fontSize: 28,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: ACCENT_ON_INK,
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            fontSize: 76,
            lineHeight: 1.05,
            color: BASE,
            fontWeight: 600,
            maxWidth: 980,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 30, color: "rgba(241,244,245,0.75)" }}>{sub}</div>
      </div>
    ),
    OG_SIZE,
  );
}
