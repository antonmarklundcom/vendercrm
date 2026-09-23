import { Eyebrow, Lead, MarkedList } from "./primitives";
import { CtaPair } from "./cta";

/**
 * The closing band. The raised checklist panel sits beside the ask it
 * supports, not before it: it used to precede the heading, so the page asked
 * visitors to "bring these answers" before saying what for. On desktop the
 * panel still rises across the band's top edge, which keeps the page's one
 * intentional overlap; on a phone it simply follows the CTA.
 */
export function CtaBand({
  eyebrow,
  title,
  body,
  panelTitle,
  panelItems,
  cta,
}: {
  eyebrow: string;
  title: string;
  body: string;
  panelTitle: string;
  panelItems: string[];
  cta: { primaryLabel: string; whatsappLabel: string; whatsappPrefill: string };
}) {
  return (
    <section
      className="mk-section mk-section--ink mk-grain mk-closing"
      aria-labelledby="mk-closing-title"
    >
      <div className="mk-wrap mk-split">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 id="mk-closing-title">{title}</h2>
          <Lead>{body}</Lead>
          <CtaPair
            primaryLabel={cta.primaryLabel}
            whatsappLabel={cta.whatsappLabel}
            whatsappPrefill={cta.whatsappPrefill}
            location="cierre"
          />
        </div>
        <div className="mk-card mk-card--raised mk-overlap">
          <h3>{panelTitle}</h3>
          <MarkedList items={panelItems} />
        </div>
      </div>
    </section>
  );
}
