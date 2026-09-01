import { getTranslations } from "next-intl/server";
import { Eyebrow } from "./primitives";

/**
 * Shared body for /privacidad and /terminos: an offset header and a single
 * prose column, measure-capped by the base styles. Deliberately quiet — no
 * CTA band, no statement; a legal page that sells reads as neither.
 */
export async function LegalPage({
  namespace,
}: {
  namespace: "privacidad" | "terminos";
}) {
  const t = await getTranslations(`marketing.legal.${namespace}`);
  const sections = t.raw("sections") as Array<{ title: string; body: string }>;

  return (
    <>
      <section className="mk-section" aria-labelledby="mk-legal-title">
        <div className="mk-wrap mk-offset">
          <Eyebrow>{t("header.eyebrow")}</Eyebrow>
          <h1 id="mk-legal-title">{t("header.title")}</h1>
          <p className="mk-eyebrow" style={{ marginTop: "0.5rem" }}>
            {t("header.updated")}
          </p>
        </div>
      </section>

      <section className="mk-section mk-section--surface mk-section--tight">
        <div className="mk-wrap mk-offset">
          {sections.map((section) => (
            <div key={section.title} style={{ marginBottom: "2.5rem" }}>
              <h2>{section.title}</h2>
              <p style={{ marginBottom: 0 }}>{section.body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
