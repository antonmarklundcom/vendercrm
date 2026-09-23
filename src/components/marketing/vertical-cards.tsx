import Link from "next/link";
import { Eyebrow, Lead } from "./primitives";

export type VerticalItem = { name: string; body: string; href?: string };

/**
 * Which cards span two of the three desktop columns, so the grid always ends
 * on a full row. The lead card carries the stagger; when that alone would
 * leave a hole (4, 7… items — every sector page has 4, which left an empty
 * cell bottom-right) the last card spans too. At a multiple of three nothing
 * spans and the stagger comes from the ink variant alone.
 */
function spansTwo(index: number, count: number): boolean {
  if (count < 4 || count % 3 === 0) return false;
  if (index === 0) return true;
  return count % 3 === 1 && index === count - 1;
}

/**
 * P3 staggered-weight grid. The first card spans two columns and uses the
 * ink variant while the rest are hairline cards — this is the direct antidote
 * to a row of identical white boxes, and it also puts the primary vertical
 * where the eye lands first.
 *
 * A card with an `href` renders as a link to its /soluciones/[vertical] page
 * (the arrow is the affordance); without one it stays a plain article, which
 * is how /metodo reuses this grid for non-navigational content.
 */
export function VerticalCards({
  eyebrow,
  title,
  lead,
  items,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  items: VerticalItem[];
}) {
  return (
    <section className="mk-section" aria-labelledby="mk-verticals-title">
      <div className="mk-wrap">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 id="mk-verticals-title">{title}</h2>
        <Lead>{lead}</Lead>

        <div className="mk-grid" style={{ marginTop: "3rem" }}>
          {items.map((item, index) => {
            const className =
              index === 0
                ? `mk-card mk-card--ink mk-grain${spansTwo(index, items.length) ? " mk-span-2" : ""}`
                : `mk-card mk-card--hair${spansTwo(index, items.length) ? " mk-span-2" : ""}`;

            const content = (
              <>
                <h3>{item.name}</h3>
                <p style={{ marginBottom: 0 }}>{item.body}</p>
              </>
            );

            return item.href ? (
              <Link
                key={item.name}
                href={item.href}
                data-reveal={index}
                data-ev="vertical_card_click"
                data-ev-loc="verticals"
                className={`${className} mk-card--link`}
              >
                {content}
                <span className="mk-card__arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            ) : (
              <article key={item.name} data-reveal={index} className={className}>
                {content}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
