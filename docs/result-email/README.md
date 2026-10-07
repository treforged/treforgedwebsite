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

## To turn it on (after Tre's yes) - a desk does all of this

1. Build the opt-in form on the calculator page: email field, an UNticked
   "also send one follow-up in 3 days" box, a send button. It posts
   `{ email, safe, perDay, days, followUp, company }`. Not built yet on purpose: a
   form for a switched-off function is a button that does nothing.
2. Change the page line "Nothing is sent anywhere: the math runs in your browser."
   It stays true for the inputs, but not for the result once a visitor asks for the email.
3. Set secrets on the treforged-site project: `RESULT_EMAIL_SIGNING_KEY` (random,
   32+ bytes) and `RESULT_EMAIL_ENABLED=on`. `RESEND_API_KEY` already exists there.
4. **Close the one open abuse path first.** Once on, anyone can make this function
   email ANY address they type. The per-IP limit (3 a minute) is a speed bump, not a
   boundary. Add Cloudflare Turnstile (free) to the form and verify its token in the
   function before the send. Do not turn it on without this.
5. Deploy the function, then send one real email to a TRE Forged address and read it.

**Undo:** unset `RESULT_EMAIL_ENABLED` (or set it to anything but `on`). Sending stops
at once. Scheduled follow-ups already at Resend still go unless cancelled there.
