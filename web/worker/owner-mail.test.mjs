// node --test "worker/*.test.mjs"   (from web/) POST /api/owner-mail: auth, validation, dry mode, the hourly backstop. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMessage, ownerMail, OWNER_FROM, OWNER_REPLY_TO, HOURLY_MAX } from "./owner-mail.mjs";

const text = "Hello,\n\nA test of Sealmark found something you should see. The policy is at https://sealmark.dev/disclosure/ and the details follow in this plain text message.\n";
const good = { to: "sec@acme.io", subject: "Private security report for acme/widget", text };
const req = (body, { token = "tok", method = "POST", headers = {} } = {}) => new Request("https://sealmark.dev/api/owner-mail", { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: method === "POST" ? JSON.stringify(body) : undefined });
const db = () => { const rows = []; return { rows, prepare: (sql) => ({ bind: (...a) => ({ first: async () => ({ n: rows.filter((r) => r.k === a[0] && r.at > a[1]).length }), run: async () => { rows.push({ k: a[0], at: a[1] }); } }) }) }; };
const env = (extra = {}) => { const sent = []; return { sent, OWNER_MAIL_TOKEN: "tok", OWNER_MAIL_LIVE: "1", DB: db(), EMAIL: { send: async (m) => { sent.push(m); } }, ...extra }; };

test("validation: address, subject, length, policy link, no HTML", () => {
  assert.equal(checkMessage(good).ok, true);
  for (const bad of [{ ...good, to: "a@b" }, { ...good, to: "x y@acme.io" }, { ...good, subject: "a\nBcc: x@y.io" }, { ...good, subject: "" }, { ...good, text: "short" }, { ...good, text: text.replace("https://sealmark.dev/disclosure/", "") }, { ...good, text: text + "<a href=x>y</a>" }, null]) assert.equal(checkMessage(bad).ok, false);
});

test("no token, a wrong token or a GET answers like any unknown /api path and sends nothing", async () => {
  const e = env();
  for (const r of [req(good, { token: null }), req(good, { token: "nope" }), req(null, { method: "GET" })]) assert.equal((await ownerMail(r, e)).status, 404);
  assert.equal((await ownerMail(req(good), env({ OWNER_MAIL_TOKEN: undefined }))).status, 404, "no secret set: closed");
  assert.equal(e.sent.length, 0);
});

test("dry unless OWNER_MAIL_LIVE is 1: validated, nothing sent", async () => {
  const e = env({ OWNER_MAIL_LIVE: "0" });
  const r = await ownerMail(req(good), e);
  assert.deepEqual(await r.json(), { ok: true, status: "dry" });
  assert.equal(e.sent.length, 0);
});

test("live: sends from the fixed sender with the fixed reply address, whatever the body says", async () => {
  const e = env();
  const r = await ownerMail(req({ ...good, from: "ceo@evil.io", replyTo: "x@evil.io", cc: "z@evil.io" }), e);
  assert.equal(r.status, 200);
  assert.equal(e.sent.length, 1);
  assert.deepEqual([e.sent[0].from, e.sent[0].replyTo, e.sent[0].to], [OWNER_FROM, OWNER_REPLY_TO, "sec@acme.io"]);
  assert.equal(e.sent[0].cc, undefined);
  assert.equal(e.sent[0].html, undefined);
});

test("a ref tags the reply address; a malformed ref is refused", async () => {
  const e = env();
  assert.equal((await ownerMail(req({ ...good, ref: "0123456789abcdef" }), e)).status, 200);
  assert.equal(e.sent[0].replyTo, "disclosure+0123456789abcdef@sealmark.dev");
  assert.equal((await ownerMail(req({ ...good, ref: "x@evil.io" }), e)).status, 400);
});

test("the unauthorised answer has the same headers as the Worker's other JSON answers", async () => {
  const r = await ownerMail(req(good, { token: "nope" }), env());
  assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
});

test("backstop: no more than HOURLY_MAX in an hour", async () => {
  const e = env();
  for (let i = 0; i < HOURLY_MAX; i++) assert.equal((await ownerMail(req(good), e)).status, 200);
  assert.equal((await ownerMail(req(good), e)).status, 429);
  assert.equal(e.sent.length, HOURLY_MAX);
});

test("a refused send is a 502 with no address or text in the answer", async () => {
  const e = env({ EMAIL: { send: async () => { throw new Error("suppressed sec@acme.io"); } } });
  const r = await ownerMail(req(good), e);
  assert.equal(r.status, 502);
  assert.doesNotMatch(await r.text(), /acme/);
});
