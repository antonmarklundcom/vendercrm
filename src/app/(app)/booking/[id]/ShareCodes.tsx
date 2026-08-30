"use client";

import { useRef } from "react";

// The QR half of plan-booking.md §6.2 #4.
//
// The SVG itself is rendered on the server (lib/qr.ts) and arrives here as a
// string: a QR for a fixed URL is the same every time, so generating it in
// the browser would be work done once per page view for no benefit.
//
// This component exists for the two things that can only happen client-side:
// handing the file to the user, and rasterising it. PNG is offered next to
// SVG because most of what these end up in — a Canva flyer, a WhatsApp
// status, a print shop's template — takes a PNG and not much else.

export type ShareCodeLabels = {
  downloadSvg: string;
  downloadPng: string;
};

export function ShareCode({
  svg,
  title,
  caption,
  filename,
  labels,
}: {
  svg: string;
  title: string;
  caption: string;
  /** Without extension; both buttons add their own. */
  filename: string;
  labels: ShareCodeLabels;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const dataUri = `data:image/svg+xml;base64,${btoa(svg)}`;

  function save(href: string, extension: string) {
    const link = document.createElement("a");
    link.href = href;
    link.download = `${filename}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function downloadPng() {
    const image = imageRef.current;
    if (!image) return;

    // Four times the on-screen size: a QR downloaded at its display size
    // looks fine on a phone and prints as mush.
    const size = 1024;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return;

    // The SVG is inlined as a data URI, so the canvas is never tainted and
    // toDataURL keeps working.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, size, size);
    save(canvas.toDataURL("image/png"), "png");
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <p className="text-sm font-medium">{title}</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- inline data URI, no loader involved */}
      <img
        ref={imageRef}
        src={dataUri}
        alt={title}
        width={160}
        height={160}
        className="h-40 w-40 self-start rounded border bg-white p-1"
      />
      <p className="break-all text-xs text-muted-foreground">{caption}</p>
      <div className="flex gap-3 text-xs">
        <button type="button" className="underline" onClick={() => save(dataUri, "svg")}>
          {labels.downloadSvg}
        </button>
        <button type="button" className="underline" onClick={downloadPng}>
          {labels.downloadPng}
        </button>
      </div>
    </div>
  );
}
