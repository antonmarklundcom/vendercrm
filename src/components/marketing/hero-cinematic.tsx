import Script from "next/script";
import { Eyebrow } from "./primitives";
import { CtaPair } from "./cta";
import { ProductPreview } from "./product-preview";

/**
 * The homepage hero, replacing the old imageless P1 split now that there is
 * a real asset to build around: a looping background video plus a "browser
 * window" preview of the pipeline the copy describes.
 *
 * Deliberately NOT a full viewport-height, nav-eating takeover (the WISA /
 * Apogee references this was adapted from both do that): the site's one
 * global header stays exactly as it is on every other page, so this section
 * fills the space below it instead of replacing it. Reskinning the sitewide
 * nav for one page would touch every route for a single-page payoff.
 *
 * Runs on `.mk-section--ink` — the same dark-field tokens `CtaBand` already
 * uses at the bottom of the page, so the two ink sections bookend the page
 * with proven-contrast typography rather than a one-off palette.
 *
 * Performance: video is `preload="none"` — nothing fetches until JS confirms
 * the visitor isn't on reduced-motion or Data Saver, both real conditions on
 * Paraguayan mobile connections. The H1 is the LCP element and never depends
 * on the video to paint.
 */
export function HeroCinematic({
  eyebrow,
  title,
  lead,
  cta,
  preview,
  videoSrc,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  cta: { primaryLabel: string; whatsappLabel: string; whatsappPrefill: string };
  preview: {
    eyebrow: string;
    url: string;
    tabs: string[];
    stages: string[];
    stats: Array<{ label: string; value: string }>;
    disclaimer: string;
  };
  videoSrc: string;
}) {
  return (
    <section
      className="mk-section mk-section--ink mk-grain mk-hero-cine"
      aria-labelledby="mk-hero-title"
    >
      <div className="mk-hero-cine__media" aria-hidden="true">
        <video
          id="mk-hero-video"
          data-hero-video={videoSrc}
          muted
          loop
          playsInline
          preload="none"
        />
        <div className="mk-hero-cine__tint" />
      </div>

      <div className="mk-wrap mk-hero-cine__content">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 id="mk-hero-title" className="mk-hero-cine__title">
          {title}
        </h1>
        <p className="mk-hero-cine__lead">{lead}</p>
        <CtaPair
          primaryLabel={cta.primaryLabel}
          whatsappLabel={cta.whatsappLabel}
          whatsappPrefill={cta.whatsappPrefill}
          location="hero"
        />
      </div>

      <div className="mk-hero-cine__preview-mount">
        <ProductPreview {...preview} />
      </div>

      {/* ~350 bytes, no dependencies. Only starts the video fetch once we know
          the visitor hasn't asked for less motion or less data — see the
          module doc comment. Runs once; there is exactly one hero video. */}
      <Script id="mk-hero-video-init" strategy="afterInteractive">
        {`(function(){
          var v = document.getElementById('mk-hero-video');
          if (!v) return;
          var src = v.getAttribute('data-hero-video');
          var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          var saveData = navigator.connection && navigator.connection.saveData;
          if (reduce || saveData || !src) return;
          v.src = src;
          v.load();
          v.play().catch(function(){});
        })();`}
      </Script>
    </section>
  );
}
