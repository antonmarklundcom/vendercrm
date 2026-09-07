// Pure, import-free (K3, PLAN.md §16.5-adjacent): strips scripts/styles,
// then every tag, then collapses whitespace — enough for a services or FAQ
// page, not a general scraper, and no DOM-parser dependency for it.
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
