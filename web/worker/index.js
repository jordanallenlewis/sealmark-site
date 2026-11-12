// The sealmark.dev Worker. Everything is the static export (ASSETS) except /api/* (wrangler.jsonc run_worker_first),
// which is the grade-change email alerts:
//   POST /api/notify/subscribe    {server, email}: double opt-in, a confirm email; same answer whatever the address
//   GET  /api/notify/confirm?t=    opens the confirm link
//   GET  /api/notify/unsubscribe?s=&t=   a page with one button; POST to the same URL (also List-Unsubscribe one-click)
//   scheduled (hourly)             compares each server's grade in worker/grades.json (rebuilt with every fleet deploy)
//                                  to the last one told, and emails confirmed subscribers once per letter change.
// Kill switch: nothing is emailed unless the NOTIFY_LIVE var is "1"; otherwise each send is logged instead.
// Secrets: NOTIFY_SECRET (HMAC key for unsubscribe links and the IP hash). D1: sealmark-notify (worker/migrations).
import GRADES from "./grades.json";
import { FROM, ORIGIN, REPLY_TO, changeEmail, confirmEmail, gradeChange } from "./notify-core.mjs";

const HOUR = 3600_000;
const LIMIT_IP = 10; // subscribe attempts per IP per hour
const LIMIT_EMAIL = 3; // per address per hour
const SAME = "If that address can receive email, a confirmation link is on its way. Nothing is sent after that unless the link is opened.";

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hmac(secret, s) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(s)));
}
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(24)));
const now = () => new Date().toISOString();
const live = (env) => env.NOTIFY_LIVE === "1";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
function page(title, message, extra = "") {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} | Sealmark</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#0d0f12;color:#e8e6e1;max-width:34rem;margin:12vh auto;padding:0 20px}a{color:#9cc4ff}button{font:inherit;padding:10px 16px;border-radius:8px;border:1px solid #444;background:#1b1f25;color:inherit;cursor:pointer}button:focus-visible{outline:2px solid #9cc4ff;outline-offset:2px}</style></head><body><main><h1 style="font-size:1.4rem">${esc(title)}</h1><p>${esc(message)}</p>${extra}<p><a href="${ORIGIN}/">sealmark.dev</a></p></main></body></html>`;
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

async function unsubscribeUrl(env, id) {
  return `${ORIGIN}/api/notify/unsubscribe?s=${id}&t=${await hmac(env.NOTIFY_SECRET, "unsub:" + id)}`;
}

// Counts this key's attempts in the last hour and records this one. True when over the limit.
async function overLimit(env, key, limit) {
  const since = Date.now() - HOUR;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?").bind(key, since).first();
  await env.DB.prepare("INSERT INTO attempts (key, at) VALUES (?, ?)").bind(key, Date.now()).run();
  return (row?.n ?? 0) >= limit;
}

async function send(env, message) {
  if (!live(env)) {
    console.log(`[notify dry] to=${message.to} subject=${JSON.stringify(message.subject)}`);
    return false;
  }
  await env.EMAIL.send({ from: FROM, replyTo: REPLY_TO, ...message });
  return true;
}

async function subscribe(request, env) {
  if (!env.NOTIFY_SECRET) return json({ ok: false, message: "Alerts are not set up yet." }, 503);
  let input = {};
  const type = request.headers.get("content-type") ?? "";
  try {
    input = type.includes("application/json") ? await request.json() : Object.fromEntries(await request.formData());
  } catch {
    return json({ ok: false, message: "Send a server and an email address." }, 400);
  }
  const id = String(input.server ?? "");
  const email = String(input.email ?? "").trim().toLowerCase();
  const row = GRADES[id];
  if (!row) return json({ ok: false, message: "Unknown server." }, 400);
  if (email.length > 254 || !/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(email)) return json({ ok: false, message: "That does not look like an email address." }, 400);

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const ipKey = "ip:" + (await hmac(env.NOTIFY_SECRET, ip));
  const emailKey = "em:" + (await sha256(email));
  if ((await overLimit(env, ipKey, LIMIT_IP)) || (await overLimit(env, emailKey, LIMIT_EMAIL))) {
    return json({ ok: false, message: "Too many requests. Try again in an hour." }, 429);
  }

  const existing = await env.DB.prepare("SELECT id, status FROM subscribers WHERE server_id = ? AND email = ?").bind(id, email).first();
  if (existing?.status === "confirmed") return json({ ok: true, message: SAME }, 202);
  const token = randomToken();
  const tokenHash = await sha256(token);
  if (existing) {
    await env.DB.prepare("UPDATE subscribers SET status = 'pending', token_hash = ?, created_at = ?, confirmed_at = NULL, unsubscribed_at = NULL WHERE id = ?").bind(tokenHash, now(), existing.id).run();
  } else {
    await env.DB.prepare("INSERT INTO subscribers (server_id, email, token_hash, status, created_at) VALUES (?, ?, ?, 'pending', ?)").bind(id, email, tokenHash, now()).run();
  }
  const mail = confirmEmail({ id, row, confirmUrl: `${ORIGIN}/api/notify/confirm?t=${token}` });
  await send(env, { to: email, ...mail, headers: { "Auto-Submitted": "auto-generated" } });
  return json({ ok: true, message: SAME }, 202);
}

async function confirm(url, env) {
  const t = url.searchParams.get("t") ?? "";
  if (!/^[0-9a-f]{48}$/.test(t)) return page("Link not valid", "This confirmation link is not valid. Ask for a new one on the server's results page.");
  const sub = await env.DB.prepare("SELECT id, server_id, status FROM subscribers WHERE token_hash = ?").bind(await sha256(t)).first();
  if (!sub) return page("Link not valid", "This confirmation link is not valid or has been replaced by a newer one. Ask for a new one on the server's results page.");
  if (sub.status !== "confirmed") await env.DB.prepare("UPDATE subscribers SET status = 'confirmed', confirmed_at = ? WHERE id = ?").bind(now(), sub.id).run();
  const name = GRADES[sub.server_id]?.name ?? sub.server_id;
  return page("Alerts on", `You will get one email when the Sealmark grade of ${name} changes. Every email has a link to stop them.`);
}

async function unsubscribe(request, url, env) {
  const id = Number(url.searchParams.get("s"));
  const t = url.searchParams.get("t") ?? "";
  const ok = env.NOTIFY_SECRET && Number.isInteger(id) && id > 0 && t === (await hmac(env.NOTIFY_SECRET, "unsub:" + id));
  if (!ok) return page("Link not valid", "This link is not valid. Reply to any alert email and we stop them by hand.");
  if (request.method === "POST") {
    await env.DB.prepare("UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?").bind(now(), id).run();
    return page("Alerts off", "You will not get any more grade emails for this server.");
  }
  // A GET only shows the button: mail scanners open links, and an unsubscribe must not happen on their visit.
  const action = `/api/notify/unsubscribe?s=${id}&amp;t=${t}`; // only validated values, never the raw query
  return page("Stop grade emails?", "One click and this address gets no more grade emails for this server.", `<form method="post" action="${action}"><button type="submit">Stop the emails</button></form>`);
}

// Hourly: one pass over every server in the bundled table.
async function tick(env) {
  await env.DB.prepare("DELETE FROM attempts WHERE at < ?").bind(Date.now() - HOUR).run();
  const known = new Map((await env.DB.prepare("SELECT server_id, letter, failing FROM grades").all()).results.map((r) => [r.server_id, { letter: r.letter, failing: JSON.parse(r.failing || "[]") }]));
  let changes = 0, sent = 0;
  for (const [id, row] of Object.entries(GRADES)) {
    if (!row.letter) continue; // a failed run says nothing about the grade
    const prev = known.get(id);
    const change = gradeChange(prev ?? null, row);
    if (prev && !change && prev.letter === row.letter) continue;
    if (change) {
      changes += 1;
      const subs = (await env.DB.prepare("SELECT id, email FROM subscribers WHERE server_id = ? AND status = 'confirmed'").bind(id).all()).results;
      for (const s of subs) {
        const unsub = await unsubscribeUrl(env, s.id);
        const mail = changeEmail({ id, row, change, unsubscribeUrl: unsub });
        const did = await send(env, { to: s.email, ...mail, headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "Auto-Submitted": "auto-generated" } });
        if (did) sent += 1;
      }
      if (subs.length) {
        await env.DB.prepare("INSERT INTO notices (server_id, letter_from, letter_to, version, failing, recipients, live, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(id, change.from, change.to, row.version, JSON.stringify(row.failing), subs.length, live(env) ? 1 : 0, now()).run();
      }
    }
    // the baseline on first sight, or the new state after a change (also when not live: no backlog piles up)
    await env.DB.prepare("INSERT INTO grades (server_id, letter, version, failing, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (server_id) DO UPDATE SET letter = excluded.letter, version = excluded.version, failing = excluded.failing, updated_at = excluded.updated_at")
      .bind(id, row.letter, row.version, JSON.stringify(row.failing), now()).run();
  }
  console.log(`[notify] ${Object.keys(GRADES).length} servers, ${changes} grade changes, ${sent} emails sent${live(env) ? "" : " (NOTIFY_LIVE off: none sent)"}`);
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, "");
    if (p === "/api/notify/subscribe" && request.method === "POST") return subscribe(request, env);
    if (p === "/api/notify/confirm" && request.method === "GET") return confirm(url, env);
    if (p === "/api/notify/unsubscribe" && (request.method === "GET" || request.method === "POST")) return unsubscribe(request, url, env);
    if (p.startsWith("/api/")) return json({ ok: false, message: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env));
  },
};

export default worker;
