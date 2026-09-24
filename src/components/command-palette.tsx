"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { SearchHit } from "@/modules/crm/search";
import { OPEN_SEARCH_EVENT } from "@/components/command-palette-event";

// ⌘K / Ctrl+K palette (PLAN.md §13 H8). The exit criterion is "any contact
// in ≤3 keystrokes + Enter", which is why the first result is selected as
// soon as results land: three characters of a name, then Enter.
export function CommandPalette({
  labels,
}: {
  labels: {
    placeholder: string;
    empty: string;
    hint: string;
    kinds: Record<string, string>;
  };
}) {
  const router = useRouter();
  const t = useTranslations("app.search");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    }
    function onOpenRequest() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpenRequest);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
      setActive(0);
      // The input mounts with the dialog, so focus waits a frame.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits([]);
      return;
    }

    // Debounced, and answers are dropped if a newer request has been sent —
    // typing fast must never leave stale hits under the cursor.
    const id = requestRef.current + 1;
    requestRef.current = id;
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        const data = (await res.json()) as { hits?: SearchHit[] };
        if (requestRef.current !== id) return;
        setHits(data.hits ?? []);
        setActive(0);
      } catch {
        if (requestRef.current === id) setHits([]);
      } finally {
        if (requestRef.current === id) setLoading(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [query, open]);

  const go = useCallback(
    (hit: SearchHit) => {
      setOpen(false);
      router.push(hit.href);
    },
    [router],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label={labels.placeholder}
      onClick={() => setOpen(false)}
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-md border bg-background shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, hits.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && hits[active]) {
              event.preventDefault();
              go(hits[active]);
            }
          }}
          placeholder={labels.placeholder}
          className="border-b px-4 py-3 text-sm outline-none"
          aria-label={labels.placeholder}
        />

        <ul className="max-h-80 overflow-y-auto">
          {hits.map((hit, index) => (
            <li key={`${hit.kind}-${hit.id}`}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => go(hit)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                  index === active ? "bg-accent" : ""
                }`}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{hit.title}</span>
                  {hit.subtitle && (
                    <span className="truncate text-xs text-muted-foreground">{hit.subtitle}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {labels.kinds[hit.kind] ?? hit.kind}
                </span>
              </button>
            </li>
          ))}

          {hits.length === 0 && query.trim().length >= 2 && !loading && (
            <li className="px-4 py-3 text-sm text-muted-foreground">{labels.empty}</li>
          )}
          {loading && hits.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground">{t("searching")}</li>
          )}
        </ul>

        <p className="border-t px-4 py-2 text-xs text-muted-foreground">{labels.hint}</p>
      </div>
    </div>
  );
}
