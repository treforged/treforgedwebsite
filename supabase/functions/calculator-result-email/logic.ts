/** Determines if the kill‑switch is enabled. */
export function isEnabled(raw: string | undefined): boolean {
  return raw === "on";
}

/** Input shape for result calculations. */
export type ResultInput = {
  email: string;
  safe: number;
  perDay: number;
  days: number;
  followUp: boolean;
};

/** Parses an unknown body into a validated ResultInput. */
export function parseInput(
  body: unknown,
):
  | { ok: true; value: ResultInput }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_result" };
  }

  const obj = body as Record<string, unknown>;

  // Honeypot check
  if (typeof obj.company === "string" && obj.company.trim() !== "") {
    return { ok: false, error: "honeypot" };
  }

  // Email validation
  if (typeof obj.email !== "string") {
    return { ok: false, error: "invalid_email" };
  }
  const email = obj.email.trim().toLowerCase();
  if (email.length > 254) {
    return { ok: false, error: "invalid_email" };
  }
  const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  if (!emailRegex.test(email)) {
    return { ok: false, error: "invalid_email" };
  }

  // Safe validation
  if (typeof obj.safe !== "number" || !Number.isFinite(obj.safe)) {
    return { ok: false, error: "invalid_result" };
  }
  const safe = obj.safe;
  if (Math.abs(safe) > 10_000_000) {
    return { ok: false, error: "invalid_result" };
  }

  // perDay validation
  if (typeof obj.perDay !== "number" || !Number.isFinite(obj.perDay)) {
    return { ok: false, error: "invalid_result" };
  }
  const perDay = obj.perDay;
  if (perDay < 0 || perDay > 10_000_000) {
    return { ok: false, error: "invalid_result" };
  }

  // Days validation
  if (typeof obj.days !== "number" || !Number.isFinite(obj.days)) {
    return { ok: false, error: "invalid_result" };
  }
  const days = obj.days;
  if (!Number.isInteger(days) || days < 1 || days > 31) {
    return { ok: false, error: "invalid_result" };
  }

  // Follow‑up flag
  const followUp = obj.followUp === true;

  const value: ResultInput = { email, safe, perDay, days, followUp };
  return { ok: true, value };
}

/** Formats a number as US dollars. */
export function money(n: number): string {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  let formatted = formatter.format(n);
  if (formatted.endsWith(".00")) {
    formatted = formatted.slice(0, -3);
  }
  return formatted;
}

/** Escapes characters for safe HTML interpolation. */
export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[c] as string));
}

const SITE = "https://treforged.com";
const TOOL = `${SITE}/tools/safe-to-spend-calculator/`;
const APP = "https://getforgenta.com/?utm_source=email&utm_medium=result-email&utm_campaign=safe-to-spend-calculator";

type Email = { subject: string; html: string; text: string };

function shell(inner: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#0d0d10;border-radius:12px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f5f5f5">
  <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#c9a227">TRE Forged</p>
${inner}
  <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#71717a">${footer}</p>
</div></body></html>`;
}

const P = 'style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#d4d4d8"';

/**
 * The result email: the number the visitor just saw, and nothing they typed.
 * Their balance and bills never leave the browser - only the two results do.
 */
export function resultEmail(v: ResultInput, cancelUrl: string | null): Email {
  const short = v.safe < 0;
  const headline = short
    ? `You are ${money(-v.safe)} short before payday.`
    : `You have ${money(v.safe)} safe to spend.`;
  const detail = short
    ? `Your bills and savings due in the next ${v.days} day${v.days === 1 ? "" : "s"} are more than your balance. Moving a bill date or the savings transfer is usually the quickest fix.`
    : `That is about ${money(v.perDay)} a day for the next ${v.days} day${v.days === 1 ? "" : "s"}, after the bills due before payday and the savings you move first.`;
  const followLine = cancelUrl
    ? `You asked for one follow-up in 3 days. <a href="${escapeHtml(cancelUrl)}" style="color:#a1a1aa">Cancel it</a>.`
    : "This is the only email you will get from this calculator.";
  const followText = cancelUrl
    ? `You asked for one follow-up in 3 days. Cancel it: ${cancelUrl}`
    : "This is the only email you will get from this calculator.";

  const html = shell(
    `  <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3">${escapeHtml(headline)}</h1>
  <p ${P}>${escapeHtml(detail)}</p>
  <p ${P}>The number changes every time a bill clears or money lands. <a href="${TOOL}" style="color:#c9a227">Run the calculator again</a> before you spend, or let <a href="${APP}" style="color:#c9a227">Forgenta</a> work it out from your accounts before every payday.</p>`,
    `You are getting this because you asked the Safe to Spend calculator at treforged.com to email you your result. ${followLine}`,
  );
  const text = `${headline}

${detail}

The number changes every time a bill clears or money lands. Run the calculator again before you spend: ${TOOL}
Or let Forgenta work it out from your accounts before every payday: ${APP}

You are getting this because you asked the Safe to Spend calculator at treforged.com to email you your result. ${followText}`;
  return { subject: short ? "Your safe-to-spend result: short before payday" : "Your safe-to-spend result", html, text };
}

/**
 * The one follow-up, sent 3 days later only when the visitor ticked the box.
 * It is the last email: the function stores nothing, so there is no list to stay on.
 */
export function followUpEmail(contactUrl: string): Email {
  const subject = "Has your safe-to-spend number moved?";
  const body1 = "Three days ago you worked out what was safe to spend before payday. Since then a few bills have likely cleared and some spending has happened, so the number has probably moved.";
  const body2 = "Two habits keep it honest: check it before any purchase you would not make twice, and move your savings on payday rather than at the end of the month.";
  const html = shell(
    `  <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3">${escapeHtml(subject)}</h1>
  <p ${P}>${escapeHtml(body1)}</p>
  <p ${P}>${escapeHtml(body2)}</p>
  <p ${P}><a href="${TOOL}" style="color:#c9a227">Run it again in 30 seconds</a>, or try <a href="${APP}" style="color:#c9a227">Forgenta</a>, which keeps the number current from your accounts.</p>`,
    `This is the one follow-up you asked for from the Safe to Spend calculator. You are not on any list, and we will not email you again. Questions: <a href="${escapeHtml(contactUrl)}" style="color:#a1a1aa">contact us</a>.`,
  );
  const text = `${subject}

${body1}

${body2}

Run it again: ${TOOL}
Forgenta: ${APP}

This is the one follow-up you asked for from the Safe to Spend calculator. You are not on any list, and we will not email you again. Questions: ${contactUrl}`;
  return { subject, html, text };
}
