import webpush from "web-push";

// One-off key generation for web push (PLAN.md §15.5 J2, §15.8 P2).
//
// Deliberately prints rather than writes: the keypair belongs in Hostinger's
// environment panel and in whatever the owner keeps secrets in, not in a file
// this repo could accidentally commit. Run it once per platform — not per
// tenant, not per deploy. Regenerating invalidates every browser subscription
// in existence, which is recoverable (browsers re-subscribe, the dead rows
// fall away on their first 410) but silent for as long as nobody reopens the
// app, so it is not something to do casually.

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
Add these to your environment (.env locally, the hosting panel in production).
Keep the private key secret; the public key is sent to every browser anyway.

WEB_PUSH_PUBLIC_KEY=${publicKey}
WEB_PUSH_PRIVATE_KEY=${privateKey}
WEB_PUSH_SUBJECT=mailto:you@example.com
`);
