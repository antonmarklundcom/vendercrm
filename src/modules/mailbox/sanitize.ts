import sanitizeHtml from "sanitize-html";

// Inbound HTML is sanitized once, server-side, before it is stored
// (PLAN-EMAIL.md E3/E4): no scripts, no event handlers, no forms, no iframes,
// no external stylesheets. Remote images are *blocked by default* — their
// `src` moves to `data-remote-src`, so opening a message does not tell the
// sender it was read. The thread view can restore them on request
// (`allowRemoteImages`). Inline `cid:` images are kept as-is and resolved to
// attachment URLs at render time.

const ALLOWED_TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  "img",
  "span",
  "font",
  "center",
  "u",
  "s",
  "small",
  "big",
];

const ALLOWED_STYLES = /^[\w\s#%(),.\-/'"]*$/;

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    disallowedTagsMode: "discard",
    allowedAttributes: {
      a: ["href", "title", "name", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "data-remote-src"],
      td: ["colspan", "rowspan", "align", "valign", "width", "bgcolor"],
      th: ["colspan", "rowspan", "align", "valign", "width", "bgcolor"],
      table: ["width", "cellpadding", "cellspacing", "border", "align", "bgcolor"],
      font: ["color", "face", "size"],
      "*": ["style", "align", "dir"],
    },
    allowedStyles: {
      "*": {
        color: [ALLOWED_STYLES],
        "background-color": [ALLOWED_STYLES],
        "text-align": [/^(left|right|center|justify)$/],
        "font-weight": [ALLOWED_STYLES],
        "font-style": [ALLOWED_STYLES],
        "font-size": [ALLOWED_STYLES],
        "text-decoration": [ALLOWED_STYLES],
        // No negative values: a negative margin could pull the message over
        // the page around it.
        padding: [/^[\d.\s%a-z]*$/],
        margin: [/^[\d.\s%a-z]*$/],
        border: [ALLOWED_STYLES],
        width: [ALLOWED_STYLES],
      },
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "cid", "data"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" },
      }),
      img: (tagName, attribs) => {
        const src = attribs.src ?? "";
        if (/^https?:/i.test(src)) {
          const { src: _remote, ...rest } = attribs;
          void _remote;
          return { tagName, attribs: { ...rest, "data-remote-src": src } };
        }
        return { tagName, attribs };
      },
    },
  }).trim();
}

/** Puts blocked remote images back, for "mostrar imágenes". */
export function allowRemoteImages(sanitized: string): string {
  return sanitized.replace(/\sdata-remote-src="([^"]*)"/g, ' src="$1"');
}

export function hasBlockedImages(sanitized: string): boolean {
  return /\sdata-remote-src="/.test(sanitized);
}
