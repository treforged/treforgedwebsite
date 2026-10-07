/**
 * calculator-result-email
 *
 * Emails a calculator visitor their result, and (only if they ticked the box)
 * ONE follow-up three days later. Ask 1960d8c5.
 *
 * ⚠️ OFF BY DEFAULT. Nothing sends unless the secret RESULT_EMAIL_ENABLED is
 * exactly "on". Any other value - unset, "", "true", "1", "ON" - is off, and the
 * off path makes NO network call of any kind. Turning it on is Tre's yes, not a
 * desk's: it is a new automated email in his name. Drafts and the turn-on steps:
 * docs/result-email/README.md. Gate: supabase/functions/calculator-result-email/handler.test.ts.
 *
 * POST { email, safe, perDay, days, followUp, company } -> result email now, plus
 *        the follow-up scheduled at Resend (`scheduled_at`) when followUp is true.
 *        `company` is a honeypot.
 * GET  ?c=<resendId>.<sig>  -> cancel the scheduled follow-up (the link in both emails).
 *
 * Nothing is stored. There is no table: the address goes to Resend and nowhere
 * else, and the follow-up is cancelled at Resend by its id. The cancel link is
 * HMAC-signed, so nobody can cancel someone else's email by guessing an id.
 * An address, a result or a request body is NEVER written to a log line.
 */

import { isEnabled, parseInput, resultEmail, followUpEmail } from "./logic.ts";

export type Deps = {
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
  now: () => number;
};

const FROM = "TRE Forged <noreply@treforged.com>";
const SITE = "https://treforged.com";
const FOLLOW_UP_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://treforged.com",
  "https://www.treforged.com",
  // Local dev only; never matches production traffic.
  "http://localhost:8080",
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : SITE,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

function page(message: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TRE Forged</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0d0d10;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="text-align:center;padding:32px;max-width:420px">
<p style="font-size:18px;line-height:1.6;margin:0 0 20px">${message}</p>
<a href="${SITE}" style="color:#c9a227;text-decoration:none;font-weight:600">Back to TRE Forged &rarr;</a>
</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// Coarse per-IP throttle, the same speed bump founder-waitlist uses. Edge
// instances are recycled, so this is not a boundary - the honest worst case is a
// few extra emails to an address somebody typed, which the cancel link and
// Resend's own suppression list cover.
const HITS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 3;

function throttled(key: string, now: number): boolean {
  const recent = (HITS.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  HITS.set(key, recent);
  if (HITS.size > 5000) HITS.clear();
  return recent.length > MAX_PER_WINDOW;
}

async function hmac(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare, so the signature check leaks no timing. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const RESEND_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

async function cancel(token: string, deps: Deps): Promise<Response> {
  const signingKey = deps.env("RESULT_EMAIL_SIGNING_KEY");
  const [id, sig] = token.split(".");
  if (!signingKey || !id || !sig || !RESEND_ID_RE.test(id)) {
    return page("That link is not valid.", 404);
  }
  if (!same(sig, await hmac(signingKey, id))) return page("That link is not valid.", 404);

  try {
    const res = await deps.fetch(`https://api.resend.com/emails/${id}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${deps.env("RESEND_API_KEY") ?? ""}` },
    });
    // Already sent or already cancelled both come back as an error from Resend;
    // either way there is nothing left for us to stop.
    if (!res.ok) console.error("calculator-result-email: cancel rejected", res.status);
  } catch {
    console.error("calculator-result-email: resend unreachable on cancel");
    return page("Something went wrong. Please email contact@treforged.com.", 502);
  }
  return page("Done. You will not get the follow-up email.", 200);
}

async function resendSend(
  deps: Deps,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const res = await deps.fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deps.env("RESEND_API_KEY") ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error("calculator-result-email: resend rejected", res.status);
    return null;
  }
  const data = await res.json().catch(() => ({}));
  return typeof data?.id === "string" ? data.id : null;
}

async function send(req: Request, deps: Deps): Promise<Response> {
  // THE KILL SWITCH. Checked before the body is read and before any call out,
  // so the off path cannot reach Resend by any route.
  if (!isEnabled(deps.env("RESULT_EMAIL_ENABLED"))) {
    return json(req, { ok: false, error: "disabled" }, 503);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (throttled(ip, deps.now())) return json(req, { error: "rate_limited" }, 429);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "invalid_body" }, 400);
  }

  const parsed = parseInput(body);
  if (!parsed.ok) {
    // A bot that filled the honeypot is told it worked and gets nothing.
    if (parsed.error === "honeypot") return json(req, { ok: true }, 200);
    return json(req, { error: parsed.error }, 400);
  }
  const v = parsed.value;

  // Schedule the follow-up FIRST, so the result email can carry its cancel link.
  let cancelUrl: string | null = null;
  if (v.followUp) {
    const signingKey = deps.env("RESULT_EMAIL_SIGNING_KEY");
    if (!signingKey) {
      console.error("calculator-result-email: no signing key, follow-up skipped");
    } else {
      const fnUrl = `${deps.env("SUPABASE_URL") ?? ""}/functions/v1/calculator-result-email`;
      // The follow-up is the LAST email and says so; its footer links the contact
      // page. The one-click cancel lives in the result email, because the
      // follow-up's Resend id only exists once Resend answers this call.
      const f = followUpEmail(`${SITE}/contact/`);
      try {
        const id = await resendSend(deps, {
          from: FROM,
          to: [v.email],
          subject: f.subject,
          html: f.html,
          text: f.text,
          scheduled_at: new Date(deps.now() + FOLLOW_UP_DELAY_MS).toISOString(),
        });
        if (id && RESEND_ID_RE.test(id)) {
          cancelUrl = `${fnUrl}?c=${id}.${await hmac(signingKey, id)}`;
        }
      } catch {
        console.error("calculator-result-email: resend unreachable on follow-up");
      }
    }
  }

  const r = resultEmail(v, cancelUrl);
  try {
    const id = await resendSend(deps, {
      from: FROM,
      to: [v.email],
      subject: r.subject,
      html: r.html,
      text: r.text,
    });
    if (!id) return json(req, { error: "send_failed" }, 502);
  } catch {
    console.error("calculator-result-email: resend unreachable");
    return json(req, { error: "send_failed" }, 502);
  }

  return json(req, { ok: true, followUp: cancelUrl !== null }, 200);
}

/** The whole function, with every outside dependency injected so the gate can watch it. */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }
    const token = new URL(req.url).searchParams.get("c");
    if (req.method === "GET" && token) return await cancel(token, deps);
    if (req.method === "GET") return page("That link is not valid.", 404);
    if (req.method === "POST") return await send(req, deps);
    return json(req, { error: "method_not_allowed" }, 405);
  } catch (err) {
    // Deliberately not logging `err` - a JSON parse error can echo the body,
    // and the body holds an email address.
    console.error("calculator-result-email: unhandled", err instanceof Error ? err.name : "unknown");
    return json(req, { error: "server_error" }, 500);
  }
}

if (import.meta.main) {
  Deno.serve((req) =>
    handle(req, { env: (k) => Deno.env.get(k), fetch, now: () => Date.now() })
  );
}
