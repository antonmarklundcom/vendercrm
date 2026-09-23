// Turning freshly issued site API keys into files, in the browser. The keys
// only ever exist in the response that issued them (the CRM keeps hashes), so
// the one useful thing to do with them is hand them to the operator as
// something he can keep: a CSV for a spreadsheet, or the two env lines per
// site that skills/vendercrm-lead-capture tells a site to hold.

export type ExportedKey = { domain: string; name: string; apiKey: string };

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function keysCsv(keys: ExportedKey[], appUrl: string): string {
  const lines = [
    "domain,name,vendercrm_url,vendercrm_api_key",
    ...keys.map((k) => [k.domain, k.name, appUrl, k.apiKey].map(csvCell).join(",")),
  ];
  // BOM so Excel reads the accents in business names.
  return "﻿" + lines.join("\n") + "\n";
}

export function keysEnv(keys: ExportedKey[], appUrl: string): string {
  return keys
    .map((k) => `# ${k.domain} — ${k.name}\nVENDERCRM_URL=${appUrl}\nVENDERCRM_API_KEY=${k.apiKey}\n`)
    .join("\n");
}

export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
