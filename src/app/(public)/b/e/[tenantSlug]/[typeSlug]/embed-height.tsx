"use client";

import { useEffect } from "react";

/**
 * Tells the embedding page how tall the booking form currently is
 * (plan-booking.md §6.2).
 *
 * An iframe cannot size itself, and a booking form changes height constantly
 * — a month opens, a day's times appear, the form replaces them, the
 * confirmation replaces that. Without this, an inline embed is either a
 * scrollbar inside a scrollbar or a box of dead space.
 *
 * Posts to `*` because this document does not know which origin embedded it,
 * and the height of a public page is not a secret. The receiving side in
 * `b.js` is the half that checks: it only accepts messages from the CRM's own
 * origin, so a hostile page cannot resize somebody else's widget.
 */
/** Shared with the route, which puts it on the element wrapping the form. */
export const EMBED_ROOT_ID = "vc-booking-embed-root";

export function EmbedHeight() {
  useEffect(() => {
    let last = 0;
    const post = () => {
      // The content wrapper's own box. Neither `documentElement.scrollHeight`
      // nor the body's works: both are stretched to the iframe's viewport by
      // the app's layout, so they report the height we set and the embed can
      // never shrink — it just agrees with itself.
      const root = document.getElementById(EMBED_ROOT_ID);
      if (!root) return;
      const height = Math.ceil(root.getBoundingClientRect().height);
      if (height === last || height === 0) return;
      last = height;
      window.parent.postMessage({ type: "vc-booking:height", height }, "*");
    };

    post();
    // ResizeObserver catches the layout changes; the interval is the backstop
    // for the ones it does not see (a font landing, an image decoding).
    const root = document.getElementById(EMBED_ROOT_ID);
    if (!root) return;
    const observer = new ResizeObserver(post);
    observer.observe(root);
    const timer = window.setInterval(post, 500);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
