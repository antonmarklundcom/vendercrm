// "Consultas entrando" preview for the home hero: what a client's week looks
// like once ads, Google Maps and WhatsApp are working together — messages
// arriving from real channels and turning into sales. It replaced a CRM
// pipeline screenshot on purpose: the site sells clients and sales to pymes,
// not software (MARKETING_SITE_PLAN.md §1.3, no app screenshots on the home).
//
// Every row and number comes from messages/ and is labelled illustrative
// (`disclaimer`) — sample content, never presented as one client's results.

type Stat = { label: string; value: string };
export type FeedItem = { name: string; channel: string; text: string; status: string; tone?: "won" };

export function LeadFeed({
  eyebrow,
  title,
  stats,
  items,
  disclaimer,
}: {
  eyebrow: string;
  title: string;
  stats: Stat[];
  items: FeedItem[];
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
          <span className="mk-preview__url">{title}</span>
        </div>

        <div className="mk-preview__stats">
          {stats.map((stat) => (
            <div key={stat.label} className="mk-preview__stat">
              <span className="mk-preview__stat-value">{stat.value}</span>
              <span className="mk-preview__stat-label">{stat.label}</span>
            </div>
          ))}
        </div>

        <ul className="mk-feed">
          {items.map((item) => (
            <li key={item.name} className="mk-feed__row">
              <span className="mk-feed__avatar" aria-hidden="true">
                {item.name.charAt(0)}
              </span>
              <span className="mk-feed__body">
                <span className="mk-feed__meta">
                  <strong>{item.name}</strong>
                  <span className="mk-feed__channel">{item.channel}</span>
                </span>
                <span className="mk-feed__text">{item.text}</span>
              </span>
              <span className={`mk-feed__status${item.tone === "won" ? " is-won" : ""}`}>{item.status}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mk-preview__disclaimer">{disclaimer}</p>
    </div>
  );
}
