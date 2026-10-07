// Gate for calculator-result-email. Run: deno test supabase/functions/calculator-result-email/
//
// THE CLAIM IT GUARDS: with RESULT_EMAIL_ENABLED anything other than exactly
// "on", the function makes ZERO outbound calls - for every value tried, on a
// valid body, a junk body and the honeypot. It asserts the fetch spy's call
// count, never only the status code: a 503 that still sent mail would pass a
// status check. Proven red 2026-10-06 by making isEnabled return true (see handoff).

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { handle, type Deps } from "./index.ts";
import { isEnabled, parseInput, resultEmail, followUpEmail, money, escapeHtml } from "./logic.ts";

type Call = { url: string; body: Record<string, unknown> | null };

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// The spy answers Turnstile with `human` and Resend with an id. `calls` holds
// EVERY outbound call; resend(calls) is the subset that could send mail.
function deps(env: Record<string, string | undefined>, calls: Call[], human = true, now = 1_790_000_000_000): Deps {
  return {
    env: (k) => env[k],
    now: () => now,
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ url, body });
      if (url === SITEVERIFY) {
        return Promise.resolve(new Response(JSON.stringify({ success: human }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" }), { status: 200 }));
    }) as typeof fetch,
  };
}

const resend = (calls: Call[]): Call[] => calls.filter((c) => c.url.startsWith("https://api.resend.com/"));

const VALID = { email: "Reader@Example.com ", safe: 150, perDay: 21.43, days: 7, followUp: true, turnstile: "tok" };

// A fresh IP per request, so the module-level throttle never decides a test.
let ipSeq = 0;
function post(body: unknown, ip = `203.0.113.${++ipSeq % 250}`): Request {
  return new Request("https://x.supabase.co/functions/v1/calculator-result-email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://treforged.com", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ON = { RESULT_EMAIL_ENABLED: "on", RESEND_API_KEY: "test", RESULT_EMAIL_SIGNING_KEY: "k", TURNSTILE_SECRET_KEY: "ts", SUPABASE_URL: "https://x.supabase.co" };

Deno.test("FLAG OFF: no outbound call for any off value, on any body", async () => {
  const offValues = [undefined, "", "true", "1", "ON", " on", "on ", "yes", "enabled"];
  const bodies: unknown[] = [VALID, { ...VALID, followUp: false }, "not json", { ...VALID, company: "bot" }, {}];
  let requests = 0;
  for (const flag of offValues) {
    for (const body of bodies) {
      const calls: Call[] = [];
      const res = await handle(post(body, `198.51.100.${requests % 250}`), deps({ ...ON, RESULT_EMAIL_ENABLED: flag }, calls));
      requests++;
      assertEquals(calls.length, 0, `flag=${JSON.stringify(flag)} sent ${calls.length} call(s)`);
      assertEquals(res.status, 503);
      assertEquals((await res.json()).error, "disabled");
    }
  }
  assertEquals(requests, offValues.length * bodies.length); // the loop really ran (45)
});

Deno.test("isEnabled is exact-match 'on' only", () => {
  assert(isEnabled("on"));
  for (const v of [undefined, "", "On", "ON", "true", "1", " on"]) assert(!isEnabled(v), String(v));
});

Deno.test("FLAG ON: result email + scheduled follow-up, cancel link signed", async () => {
  const calls: Call[] = [];
  const res = await handle(post(VALID), deps(ON, calls));
  assertEquals(res.status, 200);
  assertEquals(calls.length, 3);
  assertEquals(calls[0].url, SITEVERIFY); // verified BEFORE anything is sent
  const [follow, result] = resend(calls);
  assertEquals(follow.body?.to, ["reader@example.com"]);
  assert(typeof follow.body?.scheduled_at === "string", "follow-up must be scheduled, not sent now");
  assertEquals(new Date(follow.body!.scheduled_at as string).getTime() - 1_790_000_000_000, 3 * 86_400_000);
  assertEquals(result.body?.scheduled_at, undefined);
  assertStringIncludes(String(result.body?.html), "$150 safe to spend");
  assertStringIncludes(String(result.body?.html), "?c=4ef9a417-02e9-4d39-ad75-9611e0fcc33c.");
});

Deno.test("FLAG ON, no follow-up box: exactly one email, no cancel link", async () => {
  const calls: Call[] = [];
  const res = await handle(post({ ...VALID, followUp: "yes" }), deps(ON, calls));
  assertEquals(res.status, 200);
  assertEquals(resend(calls).length, 1);
  assertStringIncludes(String(resend(calls)[0].body?.html), "only email you will get");
});

Deno.test("FLAG ON: honeypot and bad input send nothing", async () => {
  for (const body of [{ ...VALID, company: "x" }, { ...VALID, email: "nope" }, { ...VALID, days: 0 }, { ...VALID, safe: NaN }]) {
    const calls: Call[] = [];
    await handle(post(body), deps(ON, calls));
    assertEquals(calls.length, 0, JSON.stringify(body));
  }
});

Deno.test("TURNSTILE: no token, a failed check, or no secret = nothing sent", async () => {
  const cases: [string, Record<string, unknown>, Record<string, string | undefined>, boolean][] = [
    ["no token", { ...VALID, turnstile: undefined }, ON, true],
    ["empty token", { ...VALID, turnstile: "" }, ON, true],
    ["bot (siteverify says no)", VALID, ON, false],
    ["no secret configured", VALID, { ...ON, TURNSTILE_SECRET_KEY: undefined }, true],
  ];
  for (const [name, body, env, human] of cases) {
    const calls: Call[] = [];
    const res = await handle(post(body), deps(env, calls, human));
    assertEquals(resend(calls).length, 0, name);
    assertEquals(res.status, 403, name);
  }
});

Deno.test("cancel: a forged signature is refused and calls nothing; a valid one cancels", async () => {
  const calls: Call[] = [];
  const d = deps(ON, calls);
  const sent: Call[] = [];
  await handle(post(VALID), deps(ON, sent));
  const link = String(resend(sent)[1].body?.html).match(/\?c=([A-Za-z0-9.-]+)/)![1];
  const [id] = link.split(".");

  const bad = await handle(new Request(`https://x/f?c=${id}.${"0".repeat(64)}`), d);
  assertEquals(bad.status, 404);
  assertEquals(calls.length, 0);

  const good = await handle(new Request(`https://x/f?c=${link}`), d);
  assertEquals(good.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, `https://api.resend.com/emails/${id}/cancel`);
});

Deno.test("copy: shortfall wording, escaping, money", () => {
  const v = parseInput({ ...VALID, safe: -42.5 });
  assert(v.ok);
  const e = resultEmail(v.value, null);
  assertStringIncludes(e.html, "You are -$42.50 short".replace("-", "")); // shown as a positive shortfall
  assertEquals(money(1234), "$1,234");
  assertEquals(money(-1234), "-$1,234");
  assertEquals(escapeHtml(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  assertStringIncludes(followUpEmail("https://treforged.com/contact/").text, "will not email you again");
});
