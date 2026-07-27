<?php
// Lead forwarder for a static HTML site on Hostinger.
// Put this next to index.html and point the form at it:
//   <form method="post" action="/lead.php">
//
// Set VENDERCRM_URL and VENDERCRM_API_KEY in hPanel → Advanced → PHP config,
// or replace getenv() below with the literal values. The key stays on the
// server either way — never inline it in the HTML.

// Honeypot: reply as if it worked so bots don't learn to drop the field.
if (!empty($_POST['_hp'])) { header('Location: /gracias.html'); exit; }

$attr = [];
if (!empty($_COOKIE['vc_attr'])) {
    $attr = json_decode($_COOKIE['vc_attr'], true) ?: [];
}

$payload = [
    'phone'        => $_POST['phone'] ?? '',   // required
    'name'         => $_POST['name'] ?? null,
    'email'        => $_POST['email'] ?? null,
    'message'      => $_POST['message'] ?? null,
    'page_url'     => $attr['landing_page'] ?? null,
    'referrer'     => $attr['referrer'] ?? null,
    'utm_source'   => $attr['utm_source'] ?? null,
    'utm_medium'   => $attr['utm_medium'] ?? null,
    'utm_campaign' => $attr['utm_campaign'] ?? null,
    'gclid'        => $attr['gclid'] ?? null,
    'fbclid'       => $attr['fbclid'] ?? null,
    // Retry-safe: the same key always returns the original lead.
    'idempotency_key' => bin2hex(random_bytes(16)),
];

$ch = curl_init(getenv('VENDERCRM_URL') . '/api/v1/leads');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 10,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'X-Api-Key: ' . getenv('VENDERCRM_API_KEY'),
    ],
    CURLOPT_POSTFIELDS     => json_encode($payload),
]);
$response = curl_exec($ch);
$status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($status < 200 || $status >= 300) {
    error_log("VenderCRM ingest failed: $status $response");
}

// The visitor sees the thank-you page either way; a CRM hiccup is not
// their problem, and the failure is in the log for you.
header('Location: /gracias.html');
exit;
