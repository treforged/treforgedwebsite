# Calculator result email - BUILT, OFF

Ask 1960d8c5. Sam approved build-but-off on 2026-10-06. **Turning it on is Tre's yes**,
because it is a new automated email in his name.

## What a visitor would get

- `drafts.txt` - both emails as plain text. Read this one.
- `1-result-email.html`, `2-follow-up-email.html` - the same emails as they render.
- Email 1 goes at once and carries ONLY the result (safe to spend, per day, days).
  The balance and bills the visitor typed never leave the browser.
- Email 2 goes 3 days later, and ONLY if the visitor ticks a box. It is the last
  email. Email 1 carries a one-click cancel for it.
- Nothing is stored. No table, no list. The address goes to Resend and nowhere else.

## How it is held off

`supabase/functions/calculator-result-email/` is in the repo and is **not deployed**.
Even deployed, it sends nothing unless the secret `RESULT_EMAIL_ENABLED` is exactly `on`.
The gate `deno test supabase/functions/calculator-result-email/` proves the off path
makes zero outbound calls (45 request shapes), and runs in CI (`lint.yml`, job
`result-email-off`). It was proven red two ways on 2026-10-06.

## To turn it on (after Tre's yes) - everything is built, so this is config

The form, the Turnstile check and the function are all built and tested. What is left:

1. **Create a Cloudflare Turnstile widget** for `treforged.com` (free; Cloudflare dashboard >
   Turnstile > Add widget, mode Managed). It gives two keys:
   - the SITE key -> replace `TURNSTILE_SITE_KEY` in `data-sitekey` in
     `tools/safe-to-spend-calculator/index.html`;
   - the SECRET key -> Supabase secret `TURNSTILE_SECRET_KEY` on the treforged-site project.
   No desk can create the widget: the Cloudflare connector here has no Turnstile tool.
2. Set the other secrets on treforged-site: `RESULT_EMAIL_SIGNING_KEY` (random, 32+ bytes) and
   `RESULT_EMAIL_ENABLED=on`. `RESEND_API_KEY` already exists there.
3. Deploy the function (`calculator-result-email`, JWT verification off, like founder-waitlist).
4. Remove `hidden` from `<section id="resultEmailBlock">` on the page, and reword the hero line
   "Nothing is sent anywhere: the math runs in your browser." The inputs still stay in the browser,
   but the result is sent once a visitor asks for the email.
5. Send one real email to a TRE Forged address and read it.

The function fails closed: with no Turnstile secret, or a token Cloudflare rejects, nothing sends.

**Undo:** unset `RESULT_EMAIL_ENABLED` (or set it to anything but `on`). Sending stops at once.
Put `hidden` back on the section to remove the form. Scheduled follow-ups already at Resend
still go unless cancelled there.

## Gates

- `deno test supabase/functions/calculator-result-email/` - 8 tests: zero sends with the flag off
  (45 requests), zero sends without a valid Turnstile token, cancel-link signing.
- `node tools/safe-to-spend-calculator/result-email.test.mjs` - 15 checks: the shipped section is
  hidden, off loads and sends nothing, and the payload carries only the result.
- Both run in CI, job `result-email-off`. Each was proven red by breaking the thing it guards.
