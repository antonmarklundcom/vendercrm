// Structured data for the marketing pages (seo-web-builds §3). One script per
// entity; the content must mirror what the page visibly renders — nothing in
// here may claim what the page doesn't show, and (locked decision) never
// aggregateRating/review.

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // "<" escaped so user-provided-looking copy can never close the tag.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
