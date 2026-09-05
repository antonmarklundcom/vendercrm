"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { whatsappHref } from "@/lib/site-config";
import {
  isMarketingVertical,
  type MarketingVertical,
} from "@/app/(marketing)/soluciones/verticals";

// Two floating entry points to the same WhatsApp menu (owner request: one
// reachable near the header, one that follows scroll like the classic
// bottom-right widget). Both read the current route so the "diagnóstico"
// option reuses each page's own waPrefill copy — the vertical pages already
// had one each (messages/es.json marketing.soluciones.*.waPrefill), this just
// wires it into a second, always-visible CTA instead of only the page's own
// closing band.

function verticalFromPathname(pathname: string): MarketingVertical | null {
  const match = pathname.match(/^\/soluciones\/([^/]+)/);
  const slug = match?.[1];
  return slug && isMarketingVertical(slug) ? slug : null;
}

function WhatsAppGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.24 8.24c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.79.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.23.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.17 1.73 2.64 4.2 3.71.59.25 1.04.4 1.4.52.59.19 1.12.16 1.55.1.47-.07 1.47-.6 1.68-1.18.2-.58.2-1.08.14-1.18-.06-.11-.22-.17-.47-.29Z" />
    </svg>
  );
}

type Option = { key: string; label: string; prefill: string };

function useWhatsAppOptions(): Option[] {
  const t = useTranslations("marketing");
  const pathname = usePathname();
  const vertical = verticalFromPathname(pathname);

  const diagnosticoPrefill = vertical
    ? t(`soluciones.${vertical}.waPrefill`)
    : pathname.startsWith("/recursos")
      ? t("recursos.waPrefill")
      : t("cta.waPrefill");

  return [
    { key: "diagnostico", label: t("waFloating.diagnostico"), prefill: diagnosticoPrefill },
    {
      key: "question",
      label: t("waFloating.question"),
      prefill: t("waFloating.questionPrefill"),
    },
    {
      key: "existingClient",
      label: t("waFloating.existingClient"),
      prefill: t("waFloating.existingClientPrefill"),
    },
  ];
}

function WhatsAppTrigger({
  position,
  options,
  ariaLabel,
  location,
}: {
  position: "top" | "bottom";
  options: Option[];
  ariaLabel: string;
  location: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`mk-wa-float mk-wa-float--${position}`}>
      <button
        type="button"
        className="mk-wa-float__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <WhatsAppGlyph />
        <span className="mk-wa-float__triggerLabel">WhatsApp</span>
      </button>

      {open ? (
        <div className="mk-wa-float__panel" role="menu">
          {options.map((option) => {
            const href = whatsappHref(option.prefill);
            if (!href) return null;
            return (
              <a
                key={option.key}
                href={href}
                role="menuitem"
                target="_blank"
                rel="noopener noreferrer"
                className="mk-wa-float__option"
                data-ev="whatsapp_click"
                data-ev-loc={`${location}:${option.key}`}
                onClick={() => setOpen(false)}
              >
                {option.label}
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function WhatsAppFloatingMenu() {
  const options = useWhatsAppOptions();
  const ariaLabel = useTranslations("marketing")("waFloating.ariaLabel");

  // No number configured (site-config TODO still open): render nothing,
  // same rule the inline WhatsAppLink follows.
  if (!whatsappHref("")) return null;

  return (
    <>
      <WhatsAppTrigger
        position="top"
        options={options}
        ariaLabel={ariaLabel}
        location="float-top"
      />
      <WhatsAppTrigger
        position="bottom"
        options={options}
        ariaLabel={ariaLabel}
        location="float-bottom"
      />
    </>
  );
}
