#!/usr/bin/env node
/**
 * send-digest.mjs — free weekly newsletter digest.
 * -------------------------------------------------------------
 * Reads posts published in the last 7 days from content-queue/published.json,
 * pulls subscribers from the locked-down Supabase table (service role bypasses
 * RLS), and emails a branded digest to each via the Resend API. Runs from the
 * weekly-digest GitHub Action. No ongoing cost (Resend free tier).
 *
 * Required repo secrets (Settings → Secrets and variables → Actions):
 *   RESEND_API_KEY              — from resend.com
 *   SUPABASE_SERVICE_ROLE_KEY   — Supabase project → Settings → API (service_role, secret)
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://treforged.com';
const SUPABASE_URL = 'https://mdtosrbfkextcaezuclh.supabase.co';
const FROM = 'The Forge — TRE Forged <noreply@treforged.com>';
const UNSUB = 'mailto:contact@treforged.com?subject=Unsubscribe';
const WINDOW_DAYS = 7;
const UTM = 'utm_source=newsletter&utm_medium=email&utm_campaign=weekly-digest';

const RESEND_KEY = process.env.RESEND_API_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  if (!RESEND_KEY || !SERVICE_KEY) {
    console.log('::notice::RESEND_API_KEY / SUPABASE_SERVICE_ROLE_KEY not set — skipping. Add the repo secrets to enable the digest.');
    return;
  }

  // 1) Posts from the last WINDOW_DAYS days.
  const published = JSON.parse(await readFile(join(ROOT, 'content-queue', 'published.json'), 'utf8'));
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const recent = published.filter((p) => (p.published || p.date) >= cutoff);
  if (!recent.length) {
    console.log(`::notice::No posts in the last ${WINDOW_DAYS} days — nothing to send.`);
    return;
  }

  // 2) Subscribers (service role bypasses RLS).
  const subsRes = await fetch(`${SUPABASE_URL}/rest/v1/newsletter_subscribers?select=email`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!subsRes.ok) {
    console.error('Failed to read subscribers:', subsRes.status, await subsRes.text());
    process.exit(1);
  }
  const subscribers = await subsRes.json();
  if (!subscribers.length) {
    console.log('::notice::No subscribers yet — nothing to send.');
    return;
  }

  // 3) Build the email.
  const subject = recent.length === 1
    ? recent[0].title
    : `${recent.length} new guides from The Forge`;
  const html = renderEmail(recent);

  // 4) Send one email per subscriber (individual = privacy + per-user unsubscribe).
  let sent = 0, failed = 0;
  for (const { email } of subscribers) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject,
        html,
        headers: { 'List-Unsubscribe': `<${UNSUB}>` },
      }),
    });
    if (r.ok) { sent++; }
    else { failed++; console.error('send failed:', email, r.status, await r.text()); }
    await sleep(600); // stay under Resend's 2 req/s limit
  }

  console.log(`::notice::Digest "${subject}" → sent ${sent}, failed ${failed} (of ${subscribers.length}).`);
  if (failed && !sent) process.exit(1);
};

const renderEmail = (posts) => {
  const cards = posts.map((p) => {
    const url = `${SITE}/blog/${p.slug}/?${UTM}`;
    return `
        <tr><td style="padding:0 0 18px 0;">
          <a href="${url}" style="color:#ece8f4;font-size:18px;font-weight:700;text-decoration:none;line-height:1.3;">${esc(p.title)}</a>
          <p style="margin:6px 0 8px;color:#a99fbe;font-size:14px;line-height:1.6;">${esc(p.description)}</p>
          <a href="${url}" style="color:#e8c37a;font-size:14px;font-weight:600;text-decoration:none;">Read the guide &rarr;</a>
        </td></tr>`;
  }).join('');

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0d0a13;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d0a13;">
    <tr><td align="center" style="padding:28px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#16111f;border:1px solid rgba(181,139,255,0.18);border-radius:14px;overflow:hidden;font-family:'Segoe UI',system-ui,-apple-system,Helvetica,Arial,sans-serif;">
        <tr><td style="padding:26px 28px 8px;border-bottom:1px solid rgba(181,139,255,0.12);">
          <div style="color:#b58bff;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">The Forge · TRE Forged</div>
          <div style="color:#ece8f4;font-size:22px;font-weight:800;margin-top:6px;">Fresh from the blog</div>
        </td></tr>
        <tr><td style="padding:22px 28px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards}
          </table>
        </td></tr>
        <tr><td style="padding:16px 28px 26px;">
          <a href="${SITE}/blog/?${UTM}" style="display:inline-block;background:#e8c37a;color:#2a2113;font-size:14px;font-weight:700;text-decoration:none;padding:11px 20px;border-radius:8px;">Browse all guides &rarr;</a>
        </td></tr>
        <tr><td style="padding:18px 28px 24px;border-top:1px solid rgba(181,139,255,0.12);color:#786d8e;font-size:12px;line-height:1.6;">
          You're getting this because you subscribed at treforged.com.
          <a href="${UNSUB}" style="color:#a99fbe;">Unsubscribe</a>.<br>
          © 2026 TRE Forged LLC · <a href="${SITE}/?${UTM}" style="color:#a99fbe;">treforged.com</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
};

main().catch((err) => { console.error(err); process.exit(1); });
