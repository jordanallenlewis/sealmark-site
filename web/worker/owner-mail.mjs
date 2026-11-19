// POST /api/owner-mail: the one route the fleet uses to send a private security notice to a server's maintainer
// (fleet/email-notices.mjs). It is a narrow mailer, not a general one: a Worker secret (OWNER_MAIL_TOKEN) is required, the
// sender and reply address are fixed here, the body must carry the disclosure policy link, there is no HTML and no
// tracking, and at most HOURLY_MAX are sent in an hour (counted in the existing `attempts` table, which the hourly tick purges after an hour: no migration).
// Live only when the OWNER_MAIL_LIVE var is "1" (web/wrangler.jsonc); otherwise the route answers {status: "dry"} and
// sends nothing. Never logs an address or a body.
export const OWNER_FROM = { email: "security@notify.sealmark.dev", name: "Sealmark security notices" };
// A reply goes to disclosure@sealmark.dev; with a `ref` (16 hex characters: the notice's keyed hash, which is already in the public ledger)
// it goes to disclosure+<ref>@sealmark.dev, so the reply can be matched to its notice without storing an address.
export const OWNER_REPLY_TO = "disclosure@sealmark.dev";
export const POLICY_URL = "https://sealmark.dev/disclosure/";
export const HOURLY_MAX = 2; // the fleet sends one an hour apart: this is the backstop if the fleet's own caps fail
const ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const HOUR = 60 * 60 * 1000;
// the same headers as the Worker's other JSON answers, so a 404 here cannot be told from any other unknown /api/ path
const out = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function equal(a, b) {
  const x = String(a), y = String(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return d === 0;
}

/** Checks a request body. Returns {ok: true, message} or {ok: false, why}. Pure. */
export function checkMessage(b) {
  if (!b || typeof b !== "object") return { ok: false, why: "no body" };
  const { to, subject, text, ref } = b;
  if (typeof to !== "string" || !ADDRESS.test(to)) return { ok: false, why: "to" };
  if (typeof subject !== "string" || !subject.trim() || subject.length > 200 || /[\r\n]/.test(subject)) return { ok: false, why: "subject" };
  if (typeof text !== "string" || text.length < 80 || text.length > 8000) return { ok: false, why: "text" };
  if (!text.includes(POLICY_URL)) return { ok: false, why: "policy link" };
  if (/<\s*(html|a\s|img|script)/i.test(text)) return { ok: false, why: "html" };
  if (ref !== undefined && !(typeof ref === "string" && /^[0-9a-f]{16}$/.test(ref))) return { ok: false, why: "ref" };
  return { ok: true, message: { to, subject, text, ref } };
}

export async function ownerMail(request, env) {
  if (request.method !== "POST") return out({ ok: false, message: "Not found." }, 404);
  const token = env.OWNER_MAIL_TOKEN;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || !given || !equal(given, token)) return out({ ok: false, message: "Not found." }, 404); // the same answer as any other /api/ path
  let body;
  try { const raw = await request.text(); if (raw.length > 20_000) return out({ ok: false, why: "too large" }, 413); body = JSON.parse(raw); } catch { return out({ ok: false, why: "json" }, 400); }
  const c = checkMessage(body);
  if (!c.ok) return out({ ok: false, why: c.why }, 400);
  if (env.OWNER_MAIL_LIVE !== "1") return out({ ok: true, status: "dry" });
  const since = Date.now() - HOUR;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?").bind("owner-mail", since).first();
  if ((row?.n ?? 0) >= HOURLY_MAX) return out({ ok: false, why: "hourly limit" }, 429);
  await env.DB.prepare("INSERT INTO attempts (key, at) VALUES (?, ?)").bind("owner-mail", Date.now()).run();
  try {
    await env.EMAIL.send({ from: OWNER_FROM, replyTo: c.message.ref ? OWNER_REPLY_TO.replace("@", `+${c.message.ref}@`) : OWNER_REPLY_TO, to: c.message.to, subject: c.message.subject, text: c.message.text });
    return out({ ok: true, status: "sent" });
  } catch (e) {
    console.error(`[owner-mail] send failed: ${String(e?.message ?? e).slice(0, 200)}`); // no address, no body
    return out({ ok: false, why: "send failed" }, 502);
  }
}
