// Photoreal-ish "browser window" preview of the pipeline the copy talks
// about — visual proof that "un sistema, no con suerte" is a real screen and
// not a metaphor. Numbers are explicitly labelled illustrative (`disclaimer`)
// rather than presented as one client's results — PLAN.md's rule against
// inventing social proof is about claimed outcomes, not mock UI content, but
// the label keeps this preview honest either way.
//
// Card chips use generic Paraguayan first names and Gs. amounts as sample
// data, the same way any SaaS screenshot ships with seeded demo content.

type Stat = { label: string; value: string };

const SAMPLE_CARDS: Array<{ name: string; amount: string; stage: number; whatsapp?: boolean }> = [
  { name: "Rocío B.", amount: "Gs. 2.400.000", stage: 0, whatsapp: true },
  { name: "Diego M.", amount: "Gs. 5.100.000", stage: 1 },
  { name: "Laura F.", amount: "Gs. 1.800.000", stage: 1, whatsapp: true },
  { name: "Carlos N.", amount: "Gs. 8.900.000", stage: 2 },
  { name: "Ana P.", amount: "Gs. 3.200.000", stage: 3 },
];

export function ProductPreview({
  eyebrow,
  url,
  tabs,
  stages,
  stats,
  disclaimer,
}: {
  eyebrow: string;
  url: string;
  tabs: string[];
  stages: string[];
  stats: Stat[];
  disclaimer: string;
}) {
  return (
    <div className="mk-preview" data-reveal="2">
      <p className="mk-preview__eyebrow">{eyebrow}</p>

      <div className="mk-preview__window">
        <div className="mk-preview__titlebar">
          <span className="mk-preview__dot mk-preview__dot--red" />
          <span className="mk-preview__dot mk-preview__dot--amber" />
          <span className="mk-preview__dot mk-preview__dot--green" />
          <span className="mk-preview__url">{url}</span>
        </div>

        <div className="mk-preview__tabs">
          {tabs.map((tab, i) => (
            <span key={tab} className={i === 0 ? "is-active" : undefined}>
              {tab}
            </span>
          ))}
        </div>

        <div className="mk-preview__stats">
          {stats.map((stat) => (
            <div key={stat.label} className="mk-preview__stat">
              <span
                className="mk-preview__stat-value"
                data-count={parseFloat(stat.value)}
                data-count-suffix={stat.value.replace(/^[\d.]+/, "")}
              >
                {stat.value}
              </span>
              <span className="mk-preview__stat-label">{stat.label}</span>
            </div>
          ))}
        </div>

        <div className="mk-preview__board">
          {stages.map((stage, columnIndex) => (
            <div key={stage} className="mk-preview__column">
              <p className="mk-preview__column-title">{stage}</p>
              {SAMPLE_CARDS.filter((card) => card.stage === columnIndex).map((card) => (
                <div key={card.name} className="mk-preview__card">
                  <span className="mk-preview__card-name">{card.name}</span>
                  <span className="mk-preview__card-amount">{card.amount}</span>
                  {card.whatsapp ? <span className="mk-preview__card-wa" aria-hidden="true" /> : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <p className="mk-preview__disclaimer">{disclaimer}</p>
    </div>
  );
}
