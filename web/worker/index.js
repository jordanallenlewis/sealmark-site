// The sealmark.dev Worker. Everything is the static export (ASSETS) except /api/* (wrangler.jsonc run_worker_first),
// which is the grade-change email alerts:
//   POST /api/notify/subscribe       {server, email} as application/json from a sealmark.dev page: double opt-in, a
//                                    confirm email; the same answer whatever the address
//   GET  /api/notify/confirm?s=&t=   a page with one button; POST to the same URL confirms (mail scanners open links)
//   GET  /api/notify/unsubscribe?s=&t=       a page with one button; POST to the same URL (also List-Unsubscribe one-click)
//   GET  /api/notify/unsubscribe-all?s=&t=   the same, for every server the address follows
//   scheduled (hourly)               compares each server's grade in worker/grades.json (rebuilt with every fleet deploy)
//                                    to the last one told, and emails confirmed subscribers once per letter change.
// Also /api/visit and /api/visits: where visitors come from (worker/visits.mjs; referrer host and UTM only).
// Kill switch: nothing is emailed unless the NOTIFY_LIVE var is "1"; otherwise each send is logged instead.
// Secrets: NOTIFY_SECRET (HMAC key for links and the rate-limit hashes). D1: sealmark-notify (worker/migrations).
// Optional Turnstile on subscribe (off): NOTIFY_TURNSTILE "1" plus the TURNSTILE_SECRET secret; the form then has to
// send the widget's token as `turnstile` (TURNSTILE_SITE_KEY is the public key the form renders with).
// Mass changes: more than MASS_SHARE of graded servers (and at least MASS_MIN) changing in one tick sends nothing and
// keeps the old baselines. After a review set NOTIFY_MASS_CHANGE to "baseline" (record the new grades, no email) or
// "send" (email as usual) for one deploy, then remove it.
import GRADES from "./grades.json" with { type: "json" };
import { FROM, ORIGIN, REPLY_TO, changeEmail, confirmEmail, gradeChange, holdInconclusive } from "./notify-core.mjs";
import { purgeVisits, recordVisit, visitsReport } from "./visits.mjs";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const LIMIT_IP = 10; // subscribe attempts per IP (IPv6: per /64) per hour
const LIMIT_EMAIL = 3; // per address per hour, after normalizing (case, +tag, Gmail dots)
const PENDING_DAYS = 7; // an unconfirmed sign-up and its confirm link last this long (stated on /notify/)
const MASS_SHARE = 0.1;
const MASS_MIN = 5;
const SAME = "If that address can receive email, a confirmation link is on its way. Nothing is sent after that unless the link is opened.";
const ORIGINS = new Set([ORIGIN, "https://www.sealmark.dev"]);

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hmac(secret, s) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(s)));
}
// Compares two strings without returning early on the first difference.
function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(24)));
const now = () => new Date().toISOString();
const live = (env) => env.NOTIFY_LIVE === "1";

// The address the rate limit counts: lowercased, without a +tag, and without dots for Gmail (all deliver to one inbox).
function normalizeEmail(email) {
  const at = email.lastIndexOf("@");
  let local = email.slice(0, at).toLowerCase();
  let domain = email.slice(at + 1).toLowerCase();
  local = local.split("+")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replaceAll(".", "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

// The rate-limit key of an IP: IPv4 as is, IPv6 by its /64 (one subscriber line usually gets a whole /64).
function ipBucket(ip) {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
function page(title, message, extra = "", status = 200) {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} | Sealmark</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#0d0f12;color:#e8e6e1;max-width:34rem;margin:12vh auto;padding:0 20px}a{color:#9cc4ff}button{font:inherit;padding:10px 16px;border-radius:8px;border:1px solid #444;background:#1b1f25;color:inherit;cursor:pointer}button:focus-visible{outline:2px solid #9cc4ff;outline-offset:2px}</style></head><body><main><h1 style="font-size:1.4rem">${esc(title)}</h1><p>${esc(message)}</p>${extra}<p><a href="${ORIGIN}/">sealmark.dev</a></p></main></body></html>`;
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
const button = (action, label) => `<form method="post" action="${action}"><button type="submit">${label}</button></form>`;

const unsubToken = (env, id) => hmac(env.NOTIFY_SECRET, "unsub:" + id);
const unsubAllToken = (env, id) => hmac(env.NOTIFY_SECRET, "unsub-all:" + id);
const unsubscribeUrl = async (env, id) => `${ORIGIN}/api/notify/unsubscribe?s=${id}&t=${await unsubToken(env, id)}`;
const unsubscribeAllUrl = async (env, id) => `${ORIGIN}/api/notify/unsubscribe-all?s=${id}&t=${await unsubAllToken(env, id)}`;

// Counts this key's attempts in the last hour and records this one. True when over the limit.
async function overLimit(env, key, limit) {
  const since = Date.now() - HOUR;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?").bind(key, since).first();
  await env.DB.prepare("INSERT INTO attempts (key, at) VALUES (?, ?)").bind(key, Date.now()).run();
  return (row?.n ?? 0) >= limit;
}

// One send. Never throws: a refused send (a suppressed address after a bounce or complaint, a sending limit) is
// logged and returned as {status: "failed"}, so one bad address cannot stop the rest of the batch.
async function send(env, message) {
  if (!live(env)) {
    console.log(`[notify dry] to=${message.to} subject=${JSON.stringify(message.subject)}`);
    return { status: "dry" };
  }
  try {
    await env.EMAIL.send({ from: FROM, replyTo: REPLY_TO, ...message });
    return { status: "sent" };
  } catch (e) {
    const error = String(e?.message ?? e).slice(0, 300);
    console.error(`[notify] send failed subject=${JSON.stringify(message.subject)}: ${error}`);
    return { status: "failed", error };
  }
}

async function turnstileOk(env, token, ip) {
  if (env.NOTIFY_TURNSTILE !== "1") return true;
  if (!env.TURNSTILE_SECRET || !token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: String(token), remoteip: ip }),
    });
    return (await res.json())?.success === true;
  } catch {
    return false;
  }
}

async function subscribe(request, env) {
  if (!env.NOTIFY_SECRET) return json({ ok: false, message: "Alerts are not set up yet." }, 503);
  // Only the site's own form: a JSON body needs a CORS preflight cross-site (so a plain HTML form on another site
  // cannot post here), and the browser's Origin has to be sealmark.dev.
  if (!ORIGINS.has(request.headers.get("origin") ?? "")) return json({ ok: false, message: "Use the form on sealmark.dev." }, 403);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json({ ok: false, message: "Send JSON." }, 415);
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, message: "Send a server and an email address." }, 400);
  }
  if (!input || typeof input !== "object") return json({ ok: false, message: "Send a server and an email address." }, 400);
  const id = String(input.server ?? "");
  const email = String(input.email ?? "").trim().toLowerCase();
  const row = GRADES[id];
  if (!row) return json({ ok: false, message: "Unknown server." }, 400);
  if (email.length > 254 || !/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(email)) return json({ ok: false, message: "That does not look like an email address." }, 400);

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await turnstileOk(env, input.turnstile, ip))) return json({ ok: false, message: "The check did not pass. Reload the page and try again." }, 403);
  const ipKey = "ip:" + (await hmac(env.NOTIFY_SECRET, "ip:" + ipBucket(ip)));
  const emailKey = "em:" + (await hmac(env.NOTIFY_SECRET, "em:" + normalizeEmail(email)));
  if ((await overLimit(env, ipKey, LIMIT_IP)) || (await overLimit(env, emailKey, LIMIT_EMAIL))) {
    return json({ ok: false, message: "Too many requests. Try again in an hour." }, 429);
  }

  const existing = await env.DB.prepare("SELECT id, status FROM subscribers WHERE server_id = ? AND email = ?").bind(id, email).first();
  if (existing?.status === "confirmed") return json({ ok: true, message: SAME }, 202);
  const token = randomToken();
  const tokenHash = await sha256(token);
  let subId = existing?.id;
  if (existing) {
    await env.DB.prepare("UPDATE subscribers SET status = 'pending', token_hash = ?, created_at = ?, confirmed_at = NULL, unsubscribed_at = NULL WHERE id = ?").bind(tokenHash, now(), existing.id).run();
  } else {
    subId = (await env.DB.prepare("INSERT INTO subscribers (server_id, email, token_hash, status, created_at) VALUES (?, ?, ?, 'pending', ?) RETURNING id").bind(id, email, tokenHash, now()).first())?.id;
  }
  const mail = confirmEmail({ id, row, confirmUrl: `${ORIGIN}/api/notify/confirm?s=${subId}&t=${token}` });
  // A refused send (say a suppressed address) gets the same answer as any other: the response says nothing about it.
  await send(env, { to: email, ...mail, headers: { "Auto-Submitted": "auto-generated" } });
  return json({ ok: true, message: SAME }, 202);
}

const BAD_CONFIRM = ["Link not valid", "This confirmation link is not valid, has expired (links last 7 days), or was replaced by a newer one. Ask for a new one on the server's results page."];

async function confirm(request, url, env) {
  const s = url.searchParams.get("s");
  const t = url.searchParams.get("t") ?? "";
  if (!/^[0-9a-f]{48}$/.test(t) || (s !== null && !/^[1-9][0-9]{0,15}$/.test(s))) return page(...BAD_CONFIRM, "", 400);
  const hash = await sha256(t);
  // Links carry the row id (?s=) and the token is compared in constant time; links sent before ids were added only
  // carry the token and are looked up by its hash.
  const sub = s !== null
    ? await env.DB.prepare("SELECT id, server_id, status, token_hash, created_at FROM subscribers WHERE id = ?").bind(Number(s)).first()
    : await env.DB.prepare("SELECT id, server_id, status, token_hash, created_at FROM subscribers WHERE token_hash = ?").bind(hash).first();
  const fresh = sub && Date.parse(sub.created_at) > Date.now() - PENDING_DAYS * DAY;
  if (!sub || !safeEqual(sub.token_hash, hash) || sub.status === "unsubscribed" || (sub.status === "pending" && !fresh)) return page(...BAD_CONFIRM, "", 400);
  const name = GRADES[sub.server_id]?.name ?? sub.server_id;
  const on = page("Alerts on", `You will get one email when the Sealmark grade of ${name} changes. Every email has a link to stop them.`);
  if (sub.status === "confirmed") return on;
  if (request.method === "POST") {
    await env.DB.prepare("UPDATE subscribers SET status = 'confirmed', confirmed_at = ? WHERE id = ? AND status = 'pending'").bind(now(), sub.id).run();
    return on;
  }
  // A GET only shows the button: mail scanners (Outlook Safe Links and the like) open every link in an email.
  const action = `/api/notify/confirm?s=${sub.id}&amp;t=${t}`; // only validated values, never the raw query
  return page("Confirm grade emails", `Get one email when the Sealmark grade of ${name} changes.`, button(action, "Confirm"));
}

const BAD_LINK = ["Link not valid", "This link is not valid. Reply to any alert email and we stop them by hand."];

async function unsubscribe(request, url, env, all) {
  const raw = url.searchParams.get("s") ?? "";
  const id = Number(raw);
  const t = url.searchParams.get("t") ?? "";
  const ok = env.NOTIFY_SECRET && /^[1-9][0-9]{0,15}$/.test(raw) && safeEqual(t, await (all ? unsubAllToken : unsubToken)(env, id));
  if (!ok) return page(...BAD_LINK, "", 400);
  const path = all ? "unsubscribe-all" : "unsubscribe";
  if (request.method === "POST") {
    if (all) {
      await env.DB.prepare("UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE status != 'unsubscribed' AND email = (SELECT email FROM subscribers WHERE id = ?)").bind(now(), id).run();
      return page("All alerts off", "This address will not get any more Sealmark grade emails, for any server.");
    }
    await env.DB.prepare("UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?").bind(now(), id).run();
    return page("Alerts off", "You will not get any more grade emails for this server.");
  }
  // A GET only shows the button: mail scanners open links, and an unsubscribe must not happen on their visit.
  const action = `/api/notify/${path}?s=${id}&amp;t=${t}`; // only validated values, never the raw query
  return all
    ? page("Stop all Sealmark alerts?", "One click and this address gets no more grade emails, for any server.", button(action, "Stop all alerts"))
    : page("Stop grade emails?", "One click and this address gets no more grade emails for this server.", button(action, "Stop the emails"));
}

const parse = (s, fallback) => {
  try {
    return JSON.parse(s ?? "") ?? fallback;
  } catch {
    return fallback;
  }
};

// What this tick should do with one server, against the last state told (`prev`, null on first sight):
//   baseline  record the row (first sight, or the same letter at a new version)
//   silent    record the row without an email (Sealmark's own build changed, so the grade moved for that reason)
//   notify    a letter change at a new server version: record it and email
//   hold      nothing (a letter change with neither the server nor Sealmark changed, or nothing changed at all)
function decide(prev, row) {
  if (!prev || !prev.letter) return { action: "baseline", row };
  const cur = holdInconclusive(prev, row);
  const sealmarkMoved = Boolean(prev.sealmark && cur.sealmark && prev.sealmark !== cur.sealmark);
  const versionMoved = prev.version !== cur.version;
  if (prev.letter === cur.letter) return versionMoved || sealmarkMoved || (!prev.sealmark && cur.sealmark) ? { action: "baseline", row: cur } : { action: "hold" };
  if (sealmarkMoved) return { action: "silent", row: cur };
  if (!versionMoved) return { action: "hold" };
  const change = gradeChange(prev, cur);
  return change ? { action: "notify", row: cur, change } : { action: "hold" };
}

const upsertGrade = (env, id, row) =>
  env.DB.prepare("INSERT INTO grades (server_id, letter, version, sealmark, packs, failing, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (server_id) DO UPDATE SET letter = excluded.letter, version = excluded.version, sealmark = excluded.sealmark, packs = excluded.packs, failing = excluded.failing, updated_at = excluded.updated_at")
    .bind(id, row.letter, row.version, row.sealmark ?? null, JSON.stringify(row.packs ?? []), JSON.stringify(row.failing ?? []), now());

// A notice with nothing left to send gets its final count, and live = 1 if any email went out (fleet/impact.mjs).
const finish = (env, nid) =>
  env.DB.prepare(
    "UPDATE notices SET recipients = (SELECT COUNT(*) FROM deliveries WHERE notice_id = ?1 AND status IN ('sent', 'dry')), live = (SELECT COUNT(*) > 0 FROM deliveries WHERE notice_id = ?1 AND status = 'sent') WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM deliveries WHERE notice_id = ?1 AND status IN ('pending', 'sending'))",
  ).bind(nid).run();

// Sends every pending delivery once. A delivery is claimed (pending -> sending) before its send, so a crash or a
// second tick can never send it again; then it is marked sent, dry or failed. Notices older than a day are dropped
// rather than sent late. When a notice has nothing left pending it gets its final count (and live = 1 if any was sent).
async function deliver(env) {
  // Still 'sending' an hour on: an earlier run was cut off mid-send. Recorded as failed, never retried.
  const cut = (await env.DB.prepare("UPDATE deliveries SET status = 'failed', error = 'interrupted', updated_at = ?1 WHERE status = 'sending' AND updated_at < ?2 RETURNING notice_id").bind(now(), new Date(Date.now() - HOUR).toISOString()).all()).results;
  const touched = new Set(cut.map((r) => r.notice_id));
  const due = (await env.DB.prepare(
    "SELECT d.notice_id, d.subscriber_id, s.email, s.status AS sub_status, n.server_id, n.change, n.sent_at FROM deliveries d JOIN subscribers s ON s.id = d.subscriber_id JOIN notices n ON n.id = d.notice_id WHERE d.status = 'pending' ORDER BY d.notice_id, d.subscriber_id LIMIT 1000",
  ).all()).results;
  let sent = 0, failed = 0;
  for (const d of due) {
    touched.add(d.notice_id);
    const mark = (status, error = null) =>
      env.DB.prepare("UPDATE deliveries SET status = ?, error = ?, updated_at = ? WHERE notice_id = ? AND subscriber_id = ?").bind(status, error, now(), d.notice_id, d.subscriber_id).run();
    const row = GRADES[d.server_id];
    const change = parse(d.change, null);
    if (d.sub_status !== "confirmed" || !row || !change || Date.parse(d.sent_at) < Date.now() - DAY) {
      await mark("dropped", d.sub_status !== "confirmed" ? "unsubscribed" : "stale or missing");
      continue;
    }
    const claim = await env.DB.prepare("UPDATE deliveries SET status = 'sending', updated_at = ? WHERE notice_id = ? AND subscriber_id = ? AND status = 'pending'").bind(now(), d.notice_id, d.subscriber_id).run();
    if (!claim?.meta?.changes) continue; // another tick has it
    const unsub = await unsubscribeUrl(env, d.subscriber_id);
    const mail = changeEmail({ id: d.server_id, row: { ...row, ...change.row }, change, unsubscribeUrl: unsub, unsubscribeAllUrl: await unsubscribeAllUrl(env, d.subscriber_id) });
    const r = await send(env, { to: d.email, ...mail, headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "Auto-Submitted": "auto-generated" } });
    await mark(r.status, r.error ?? null);
    if (r.status === "sent") sent += 1;
    if (r.status === "failed") failed += 1;
  }
  for (const nid of touched) await finish(env, nid);
  return { sent, failed };
}

// Hourly: one pass over every server in the bundled table.
async function tick(env) {
  const ready = await env.DB.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'deliveries'").first();
  if (!ready) {
    console.error("[notify] D1 is missing migration 0002 (no deliveries table): nothing compared or sent. Run: npx wrangler d1 migrations apply sealmark-notify --remote");
    return;
  }
  const cutoff = new Date(Date.now() - PENDING_DAYS * DAY).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM attempts WHERE at < ?").bind(Date.now() - HOUR),
    env.DB.prepare("DELETE FROM subscribers WHERE status = 'pending' AND created_at < ?").bind(cutoff),
  ]);

  const known = new Map((await env.DB.prepare("SELECT server_id, letter, version, sealmark, packs, failing FROM grades").all()).results.map((r) => [r.server_id, { letter: r.letter, version: r.version, sealmark: r.sealmark, packs: parse(r.packs, []), failing: parse(r.failing, []) }]));
  const plans = [];
  let graded = 0;
  for (const [id, row] of Object.entries(GRADES)) {
    if (!row.letter) continue; // a failed run says nothing about the grade
    graded += 1;
    const plan = decide(known.get(id) ?? null, row);
    if (plan.action !== "hold") plans.push({ id, ...plan });
  }

  const notify = plans.filter((p) => p.action === "notify");
  const mass = notify.length >= MASS_MIN && notify.length > graded * MASS_SHARE;
  let mode = "send";
  if (mass) {
    mode = env.NOTIFY_MASS_CHANGE === "baseline" ? "baseline" : env.NOTIFY_MASS_CHANGE === "send" ? "send" : "hold";
    console.error(`[notify] MASS CHANGE: ${notify.length} of ${graded} graded servers changed letter in one tick (limit ${Math.round(MASS_SHARE * 100)}%, min ${MASS_MIN}). ${mode === "hold" ? "Nothing sent and the old baselines kept for review; set NOTIFY_MASS_CHANGE to baseline or send to release." : `NOTIFY_MASS_CHANGE=${mode}.`} Servers: ${notify.map((p) => `${p.id} ${p.change.from}->${p.change.to}`).join(", ")}`);
  }

  for (const p of plans) {
    if (p.action === "silent") console.log(`[notify] ${p.id}: Sealmark build changed (${known.get(p.id)?.sealmark} -> ${p.row.sealmark}), new grade ${p.row.letter} recorded without an email`);
    if (p.action !== "notify") {
      await upsertGrade(env, p.id, p.row).run();
      continue;
    }
    if (mode === "hold") continue;
    if (mode === "baseline") {
      await upsertGrade(env, p.id, p.row).run();
      continue;
    }
    // The notice, one pending delivery per confirmed subscriber, and the new baseline in one transaction, before any
    // send: a failure later can never make this change be detected (and emailed) again.
    const change = { ...p.change, row: { letter: p.row.letter, packs: p.row.packs, held: p.row.held ?? [] } };
    const at = now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO notices (server_id, letter_from, letter_to, version, failing, recipients, live, sent_at, change) SELECT ?1, ?2, ?3, ?4, ?5, (SELECT COUNT(*) FROM subscribers WHERE server_id = ?1 AND status = 'confirmed'), 0, ?6, ?7 WHERE EXISTS (SELECT 1 FROM subscribers WHERE server_id = ?1 AND status = 'confirmed')")
        .bind(p.id, p.change.from, p.change.to, p.row.version, JSON.stringify(p.row.failing ?? []), at, JSON.stringify(change)),
      env.DB.prepare("INSERT OR IGNORE INTO deliveries (notice_id, subscriber_id, status, updated_at) SELECT (SELECT MAX(id) FROM notices WHERE server_id = ?1), id, 'pending', ?2 FROM subscribers WHERE server_id = ?1 AND status = 'confirmed'")
        .bind(p.id, at),
      upsertGrade(env, p.id, p.row),
    ]);
  }

  const { sent, failed } = await deliver(env);
  console.log(`[notify] ${Object.keys(GRADES).length} servers, ${notify.length} grade changes${mass ? ` (mass change: ${mode})` : ""}, ${sent} emails sent, ${failed} failed${live(env) ? "" : " (NOTIFY_LIVE off: none sent)"}`);
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, "");
    const m = request.method;
    if (p === "/api/notify/subscribe" && m === "POST") return subscribe(request, env);
    if (p === "/api/notify/confirm" && (m === "GET" || m === "POST")) return confirm(request, url, env);
    if (p === "/api/notify/unsubscribe" && (m === "GET" || m === "POST")) return unsubscribe(request, url, env, false);
    if (p === "/api/notify/unsubscribe-all" && (m === "GET" || m === "POST")) return unsubscribe(request, url, env, true);
    if (p === "/api/visit" && m === "POST") return recordVisit(request, env);
    if (p === "/api/visits" && m === "GET") return visitsReport(request, url, env);
    if (p.startsWith("/api/")) return json({ ok: false, message: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env));
    ctx.waitUntil(purgeVisits(env));
  },
};

export default worker;
