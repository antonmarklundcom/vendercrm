/*
 * VenderCRM booking widget embed (plan-booking.md §6.2).
 *
 * Inline, where the business wants the form inside their own page:
 *   <div id="reservar"></div>
 *   <script src="https://YOUR-CRM/b.js"
 *           data-tenant="mi-negocio" data-type="corte"
 *           data-inline="#reservar" defer></script>
 *
 * Or as a floating button, where they just want a way in from every page:
 *   <script src="https://YOUR-CRM/b.js"
 *           data-tenant="mi-negocio" data-type="corte"
 *           data-label="Reservar turno" defer></script>
 *
 * The same reasoning as w.js, and the same shape: draw the entry point,
 * inject an iframe served from the CRM's own origin, and listen for the
 * iframe's postMessage to size it. Every request the booking form then makes
 * is SAME-ORIGIN, so no Access-Control-Allow-Origin header is added anywhere
 * and the server-to-server-only rule protecting /api/v1/leads stays as strict
 * as it was. It also keeps the host page's CSS out of the form and the form's
 * out of the host page.
 *
 * `data-tenant` and `data-type` are PUBLIC by design: they are the two
 * segments of a URL anybody can already open at /b/<tenant>/<type>. Nothing
 * is authorised by holding them.
 *
 * This is the third and last piece of client-side code this project ships.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;

  var tenant = script.getAttribute("data-tenant");
  var type = script.getAttribute("data-type");
  if (!tenant || !type) return;

  var origin = new URL(script.src, window.location.href).origin;
  var src =
    origin + "/b/e/" + encodeURIComponent(tenant) + "/" + encodeURIComponent(type);
  var inlineSelector = script.getAttribute("data-inline");
  var side = script.getAttribute("data-position") === "left" ? "left" : "right";
  var color = script.getAttribute("data-color") || "#111827";
  var label = script.getAttribute("data-label") || "Reservar turno";

  var frame = null;

  function makeFrame() {
    var element = document.createElement("iframe");
    element.src = src;
    element.title = label;
    element.setAttribute("loading", "lazy");
    // Everything the form needs and nothing else. Same-origin is what lets it
    // talk to its own API; forms and scripts are the form itself.
    element.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-popups");
    return element;
  }

  // The height the iframe reports, applied to whichever frame is on the page.
  window.addEventListener("message", function (event) {
    // Only our own iframe may drive this — an arbitrary page must not be able
    // to resize somebody's booking form.
    if (event.origin !== origin || !event.data) return;
    if (event.data.type !== "vc-booking:height" || !frame) return;
    var height = Number(event.data.height);
    // The floor keeps a mid-render measurement from collapsing the box; the
    // ceiling keeps a runaway one from pushing the host page's footer into
    // the next county.
    if (height > 0) frame.style.height = Math.min(Math.max(height, 320), 2000) + "px";
  });

  function mountInline(host) {
    frame = makeFrame();
    frame.style.cssText = "width:100%;height:640px;border:0;display:block;background:transparent";
    host.appendChild(frame);
  }

  function mountFloating() {
    var panel = document.createElement("div");
    panel.style.cssText =
      "position:fixed;bottom:88px;" + side + ":20px;z-index:2147483000;" +
      "width:400px;max-width:calc(100vw - 32px);height:640px;" +
      "max-height:calc(100vh - 120px);border-radius:16px;overflow:auto;" +
      "box-shadow:0 12px 48px rgba(0,0,0,.25);display:none;background:#fff";

    var button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText =
      "position:fixed;bottom:20px;" + side + ":20px;z-index:2147483000;" +
      "padding:14px 20px;border-radius:9999px;border:0;cursor:pointer;" +
      "font:600 15px/1 system-ui,sans-serif;color:#fff;background:" + color + ";" +
      "box-shadow:0 6px 24px rgba(0,0,0,.25)";

    var open = false;
    button.addEventListener("click", function () {
      if (!frame) {
        frame = makeFrame();
        frame.style.cssText = "width:100%;height:640px;border:0;display:block;background:#fff";
        panel.appendChild(frame);
      }
      open = !open;
      panel.style.display = open ? "block" : "none";
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.body.appendChild(panel);
    document.body.appendChild(button);
  }

  function mount() {
    if (inlineSelector) {
      var host = document.querySelector(inlineSelector);
      // An inline embed whose container is missing falls back to the floating
      // button rather than silently rendering nothing: a business that pasted
      // the snippet above their div should still get bookings.
      if (host) {
        mountInline(host);
        return;
      }
    }
    mountFloating();
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount);
  }
})();
