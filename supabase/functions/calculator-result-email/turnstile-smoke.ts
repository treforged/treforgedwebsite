// Manual smoke gate for calculator-result-email. Ask 7ac78b02.
// Run: deno run --allow-net --allow-read supabase/functions/calculator-result-email/turnstile-smoke.ts
//
// PROVES: the real handler, with a REAL Cloudflare siteverify call, builds the
// correct result email when Turnstile passes, and sends nothing when it fails.
// Uses ONLY Cloudflare's published Turnstile test keys - public documented
// constants, not secrets. Resend is never called: its request is captured here.
//
// DOES NOT PROVE: the deployed function, the production secrets, or delivery.
// Deliberately not named *test*, so CI's `deno test` does not hit the network.
//
// Exit 0 all pass, 1 a check failed, 2 Cloudflare unreachable or nothing ran.

import { handle, type Deps } from "./index.ts";

// Cloudflare's published Turnstile test values (developers.cloudflare.com/turnstile/troubleshooting/testing/).
const PASS_SECRET = "1x0000000000000000000000000000000AA";
const FAIL_SECRET = "2x0000000000000000000000000000000AA";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

type Run = { status: number; cfStatus: number | null; cfError: boolean; sent: Record<string, unknown>[] };

async function run(secret: string, ip: string): Promise<Run> {
  const out: Run = { status: 0, cfStatus: null, cfError: false, sent: [] };
  const env: Record<string, string> = {
    RESULT_EMAIL_ENABLED: "on",
    RESEND_API_KEY: "smoke-not-a-key",
    TURNSTILE_SECRET_KEY: secret,
  };
  const deps: Deps = {
    env: (k) => env[k],
    now: () => Date.now(),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://challenges.cloudflare.com/")) {
        try {
          const res = await fetch(input, init);
          out.cfStatus = res.status;
          return res;
        } catch (e) {
          out.cfError = true;
          throw e;
        }
      }
      if (url === "https://api.resend.com/emails") {
        out.sent.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: "smoke-0000-0000" }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch,
  };
  const req = new Request("https://local/calculator-result-email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://treforged.com", "x-forwarded-for": ip },
    body: JSON.stringify({
      email: "smoke@example.com", safe: 842.5, perDay: 60.18, days: 14,
      followUp: false, company: "", turnstile: DUMMY_TOKEN,
    }),
  });
  out.status = (await handle(req, deps)).status;
  return out;
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`); }
}

const good = await run(PASS_SECRET, "203.0.113.1");
const bad = await run(FAIL_SECRET, "203.0.113.2");

if (good.cfError || bad.cfError || good.cfStatus === null || bad.cfStatus === null) {
  console.log("Cloudflare siteverify was not reached - this is NOT a pass.");
  Deno.exit(2);
}

check("pass key: handler 200", good.status === 200, `got ${good.status}`);
check("pass key: Cloudflare 200", good.cfStatus === 200, `got ${good.cfStatus}`);
check("pass key: exactly one email built", good.sent.length === 1, `got ${good.sent.length}`);

const p = good.sent[0] ?? {};
const text = String(p.text ?? "");
const html = String(p.html ?? "");
check("from", p.from === "TRE Forged <noreply@treforged.com>", String(p.from));
check("to", JSON.stringify(p.to) === JSON.stringify(["smoke@example.com"]), JSON.stringify(p.to));
check("subject", p.subject === "Your safe-to-spend result", String(p.subject));
for (const s of ["$842.50 safe to spend", "$60.18 a day", "14 days", "https://treforged.com/tools/safe-to-spend-calculator/"]) {
  check(`text has "${s}"`, text.includes(s));
}
for (const s of ["$842.50 safe to spend", "<h1", "utm_source=email"]) {
  check(`html has "${s}"`, html.includes(s));
}
check("no undefined/NaN", !/undefined|NaN/.test(text + html));

check("fail key: handler 403", bad.status === 403, `got ${bad.status}`);
check("fail key: nothing built", bad.sent.length === 0, `got ${bad.sent.length}`);

const total = passed + failed;
console.log(`${passed}/${total} checks passed`);
Deno.exit(total === 0 ? 2 : failed > 0 ? 1 : 0);
