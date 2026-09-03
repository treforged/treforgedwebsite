/**
 * founder-waitlist
 *
 * Backs the one-field email capture at https://treforged.com/founders/.
 * GitHub Pages cannot run a backend, so the form posts here.
 *
 * POST  { email, company }  -> insert into public.founder_waitlist + Resend confirmation.
 *                              `company` is a honeypot: any value means a bot, and the
 *                              request is silently accepted and dropped.
 * GET   ?t=<token>          -> unsubscribe page (a person clicking the link).
 * POST  ?t=<token>          -> RFC 8058 one-click unsubscribe (the mailbox provider).
 *
 * Personal data: an address is NEVER written to a log line, here or in the catch.
 * RLS on founder_waitlist has no policies, so the service role used here is the
 * only way in or out of that table.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FROM = "TRE Forged <noreply@treforged.com>";
const SITE = "https://treforged.com";
const FN_URL = `${SUPABASE_URL}/functions/v1/founder-waitlist`;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://treforged.com",
  "https://www.treforged.com",
  // Local dev only; never matches production traffic.
  "http://localhost:8080",
  "http://localhost:3000",
  "http://localhost:5173",
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

// Coarse per-IP throttle. Edge instances are recycled, so this is a speed bump
// for a scripted form, not a security boundary - the unique index is what
// actually keeps the table clean.
const HITS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (HITS.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  HITS.set(ip, recent);
  if (HITS.size > 5000) HITS.clear();
  return recent.length > MAX_PER_WINDOW;
}

// The page works out where a signup came from and sends it, so the bio link can
// stay a bare URL. That makes `source` attacker-controlled text: it is stripped
// to a safe character set and capped, and it is never rendered into an email.
const SOURCE_DEFAULT = "treforged.com/founders";

function cleanSource(value: unknown): string {
  if (typeof value !== "string") return SOURCE_DEFAULT;
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9._:/-]/g, "").slice(0, 64);
  return cleaned || SOURCE_DEFAULT;
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function confirmationHtml(unsubUrl: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#0d0d10;border-radius:12px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f5f5f5">
  <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#c9a227">TRE Forged</p>
  <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3">You're on the list.</h1>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#d4d4d8">
    You will get build notes on running a startup with AI agents &mdash; the desk model,
    routing, the gates that catch mistakes, and talking to a live coding session from
    your phone. Real notes from real work, not a newsletter.
  </p>
  <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#d4d4d8">
    We are not promising a date. When there is something to use, you will hear it here first.
  </p>
  <p style="margin:0;font-size:12px;color:#71717a">
    You are getting this because you signed up at treforged.com/founders.
    <a href="${unsubUrl}" style="color:#a1a1aa">Unsubscribe</a>.
  </p>
</div></body></html>`;
}

async function unsubscribe(token: string): Promise<Response> {
  const { data, error } = await supabase
    .from("founder_waitlist")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("unsubscribe_token", token)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("founder-waitlist: unsubscribe failed", error.code ?? "");
    return page("Something went wrong. Please email contact@treforged.com.", 500);
  }
  if (!data) return page("That link is not valid.", 404);

  return page("You are unsubscribed. You will not get any more of these.", 200);
}

async function signup(req: Request): Promise<Response> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (throttled(ip)) return json(req, { error: "rate_limited" }, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "invalid_body" }, 400);
  }

  // Honeypot: a real person never fills a field they cannot see.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return json(req, { ok: true }, 200);
  }

  const raw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!raw || raw.length > 254 || !EMAIL_RE.test(raw)) {
    return json(req, { error: "invalid_email" }, 400);
  }

  const { data, error } = await supabase
    .from("founder_waitlist")
    .insert({ email: raw, source: cleanSource(body.source) })
    .select("unsubscribe_token")
    .single();

  if (error) {
    if (error.code === "23505") return json(req, { ok: true, already: true }, 200);
    console.error("founder-waitlist: insert failed", error.code ?? "");
    return json(req, { error: "server_error" }, 500);
  }

  const unsubUrl = `${FN_URL}?t=${data.unsubscribe_token}`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [raw],
        subject: "You're on the list",
        html: confirmationHtml(unsubUrl),
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
    // The row is saved either way - a send failure must not lose the signup.
    if (!res.ok) console.error("founder-waitlist: resend rejected", res.status);
  } catch {
    console.error("founder-waitlist: resend unreachable");
  }

  return json(req, { ok: true }, 200);
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    // A `t` param means unsubscribe, by GET (a person) or POST (RFC 8058 one-click).
    const token = new URL(req.url).searchParams.get("t");
    if (token) return await unsubscribe(token);

    if (req.method === "GET") return page("That link is not valid.", 404);
    if (req.method === "POST") return await signup(req);

    return json(req, { error: "method_not_allowed" }, 405);
  } catch (err) {
    // Deliberately not logging `err` - a JSON parse error can echo the body,
    // and the body holds an email address.
    console.error("founder-waitlist: unhandled", err instanceof Error ? err.name : "unknown");
    return json(req, { error: "server_error" }, 500);
  }
});
