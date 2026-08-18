"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Step-by-step connection guide (PLAN.md §10 1I #4). The owner's network is
// a mix of static HTML+PHP and Node.js sites, so a single generic `fetch`
// example wasn't enough — each stack gets a handler that can be pasted as-is.
//
// The one rule every snippet enforces: the API key lives in the site's
// server environment and the POST happens server-side. A key in page source
// is a key anyone can use to write into the pipeline (§5.1).

export type GuideLabels = {
  title: string;
  intro: string;
  steps: { title: string; body: string }[];
  snippetTitle: string;
  copy: string;
  copied: string;
  securityTitle: string;
  securityPoints: string[];
};

type Snippet = { id: string; label: string; language: string; code: string };

function CodeBlock({ code, copy, copied: copiedLabel }: { code: string; copy: string; copied: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the code is selectable, so this is a nicety.
    }
  }

  return (
    <div className="relative">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleCopy}
        className="absolute top-2 right-2 bg-background"
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
        {copied ? copiedLabel : copy}
      </Button>
      <pre className="overflow-x-auto rounded-md border bg-muted p-3 pt-12 text-xs">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function SiteGuide({
  appUrl,
  formEndpointExample,
  labels,
}: {
  appUrl: string;
  /** Public hosted-form URL to show as the no-backend alternative. */
  formEndpointExample: string;
  labels: GuideLabels;
}) {
  const snippets: Snippet[] = [
    {
      id: "html",
      label: "HTML",
      language: "html",
      code: `<!-- The form posts to YOUR server, never to the CRM directly. -->
<form action="/contacto.php" method="POST">
  <input name="nombre" required>
  <input name="telefono" type="tel" required placeholder="0981 123 456">
  <input name="email" type="email">
  <textarea name="mensaje"></textarea>

  <!-- Honeypot: bots fill it, humans never see it. -->
  <input name="website" tabindex="-1" autocomplete="off"
         style="position:absolute;left:-9999px" aria-hidden="true">

  <button type="submit">Enviar</button>
</form>

<!-- First-touch attribution cookie (optional but recommended). -->
<script src="${appUrl}/vc-attribution.js" defer></script>`,
    },
    {
      id: "php",
      label: "PHP",
      language: "php",
      code: `<?php
// contacto.php — runs on your server, so the key is never exposed.
$apiKey = getenv('VENDERCRM_API_KEY');

// 1. Honeypot: silently accept and drop.
if (!empty($_POST['website'])) { header('Location: /gracias.html'); exit; }

// 2. First-touch attribution written by vc-attribution.js.
$attr = json_decode($_COOKIE['vc_attr'] ?? '{}', true) ?: [];

// 3. Idempotency key — same key = same lead, so a double submit or a
//    retry after a timeout never creates a duplicate contact.
$idempotencyKey = hash('sha256', ($_POST['telefono'] ?? '') . '|' . date('Y-m-d-H'));

$payload = [
  'phone'           => $_POST['telefono'] ?? '',   // required
  'name'            => $_POST['nombre'] ?? null,
  'email'           => $_POST['email'] ?? null,
  'message'         => $_POST['mensaje'] ?? null,
  'source'          => 'formulario-contacto',
  'page_url'        => $attr['landing_page'] ?? null,
  'referrer'        => $attr['referrer'] ?? null,
  'utm_source'      => $attr['utm_source'] ?? null,
  'utm_medium'      => $attr['utm_medium'] ?? null,
  'utm_campaign'    => $attr['utm_campaign'] ?? null,
  'gclid'           => $attr['gclid'] ?? null,
  'idempotency_key' => $idempotencyKey,
];

$ch = curl_init('${appUrl}/api/v1/leads');
curl_setopt_array($ch, [
  CURLOPT_POST           => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT        => 10,
  CURLOPT_HTTPHEADER     => [
    'Content-Type: application/json',
    'X-Api-Key: ' . $apiKey,
  ],
  CURLOPT_POSTFIELDS => json_encode(array_filter($payload, fn($v) => $v !== null && $v !== '')),
]);
$response = curl_exec($ch);
$status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// 4. Never block the visitor on the CRM. Log and thank them either way.
if ($status !== 201 && $status !== 200) {
  error_log("CRM lead failed ($status): $response");
}

header('Location: /gracias.html');
exit;`,
    },
    {
      id: "node",
      label: "Node.js",
      language: "javascript",
      code: `// Express route — same rules: server-side, key from env.
import crypto from "node:crypto";

app.post("/api/contacto", async (req, res) => {
  const { nombre, telefono, email, mensaje, website } = req.body;

  // 1. Honeypot.
  if (website) return res.redirect("/gracias");

  // 2. First-touch attribution cookie.
  let attr = {};
  try {
    attr = JSON.parse(decodeURIComponent(req.cookies?.vc_attr ?? "%7B%7D"));
  } catch {}

  // 3. Stable idempotency key for this submission.
  const idempotencyKey = crypto
    .createHash("sha256")
    .update(\`\${telefono}|\${new Date().toISOString().slice(0, 13)}\`)
    .digest("hex");

  try {
    const response = await fetch("${appUrl}/api/v1/leads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": process.env.VENDERCRM_API_KEY,
      },
      body: JSON.stringify({
        phone: telefono,                 // required
        name: nombre,
        email,
        message: mensaje,
        source: "formulario-contacto",
        page_url: attr.landing_page,
        referrer: attr.referrer,
        utm_source: attr.utm_source,
        utm_medium: attr.utm_medium,
        utm_campaign: attr.utm_campaign,
        gclid: attr.gclid,
        idempotency_key: idempotencyKey,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error("CRM lead failed", response.status, await response.text());
    }
  } catch (err) {
    // 4. Never block the visitor on the CRM being reachable.
    console.error("CRM unreachable", err);
  }

  res.redirect("/gracias");
});`,
    },
    {
      id: "nostack",
      label: "Sin backend",
      language: "html",
      code: `<!-- No server to run code on? Point the form straight at the hosted
     page instead — same result, no API key to manage. -->
<a href="${formEndpointExample}">Formulario alojado</a>

<!-- Or embed it: -->
<iframe src="${formEndpointExample}" style="width:100%;height:600px;border:0"></iframe>`,
    },
  ];

  const [active, setActive] = useState(snippets[0].id);
  const current = snippets.find((snippet) => snippet.id === active) ?? snippets[0];

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{labels.title}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{labels.intro}</p>
      </div>

      <ol className="flex flex-col gap-3">
        {labels.steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{step.title}</span>
              <span className="text-sm text-muted-foreground">{step.body}</span>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{labels.snippetTitle}</span>
        <div className="flex flex-wrap gap-1">
          {snippets.map((snippet) => (
            <button
              key={snippet.id}
              type="button"
              onClick={() => setActive(snippet.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                snippet.id === active
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {snippet.label}
            </button>
          ))}
        </div>
        <CodeBlock code={current.code} copy={labels.copy} copied={labels.copied} />
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-dashed px-4 py-3">
        <span className="text-sm font-medium">{labels.securityTitle}</span>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          {labels.securityPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
