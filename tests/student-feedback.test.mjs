// Tests for the private star-rating feedback API.
// Run from the project folder:  node --test tests/
// Uses Node's built-in test runner and an in-memory SQLite database created from
// the real migration, so the SQL and constraints are tested too. Turnstile is
// replaced with a fake, so no network access is needed.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as api from "../functions/api/student-feedback/index.js";
import * as configApi from "../functions/api/student-feedback/config.js";
import { onRequest as middleware } from "../functions/_middleware.js";

const MIGRATION = fs.readFileSync(new URL("../migrations/0001_create_student_feedback.sql", import.meta.url), "utf8");
const ORIGIN = "https://istanbul-student-guide.pages.dev";
const URL_ = `${ORIGIN}/api/student-feedback`;

// Minimal D1-compatible wrapper around node:sqlite.
function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(MIGRATION);
  return {
    raw: db,
    rows: () => db.prepare("SELECT * FROM student_feedback ORDER BY id").all(),
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async run() { db.prepare(sql).run(...args); return { success: true }; },
        async first() { return db.prepare(sql).get(...args) ?? null; },
      };
    },
  };
}

const brokenDb = {
  prepare() {
    const fail = async () => { throw Object.assign(new Error("D1_ERROR: internal secret detail"), { name: "D1Error" }); };
    return { bind() { return this; }, run: fail, first: fail };
  },
};

let turnstileCalls;
let turnstileResult;
const realFetch = globalThis.fetch;

beforeEach(() => {
  api.resetRateLimiter();
  turnstileCalls = [];
  turnstileResult = { success: true, action: "student-feedback" };
  globalThis.fetch = async (url, init) => {
    turnstileCalls.push({ url: String(url), body: String(init.body) });
    if (turnstileResult === "network-error") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(turnstileResult), { status: 200, headers: { "Content-Type": "application/json" } });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

function makeEnv(overrides = {}) {
  return { DB: makeDb(), TURNSTILE_SECRET_KEY: "test-secret", TURNSTILE_SITE_KEY: "test-site-key", ...overrides };
}

function post(body, { ip = "203.0.113.10", headers = {}, raw } = {}) {
  return new Request(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": ip, ...headers },
    body: raw ?? JSON.stringify(body),
  });
}

const valid = (extra = {}) => ({ topic: "transport", rating: 5, comment: "Very clear, thank you!", website: "", turnstileToken: "token-ok", ...extra });

async function call(request, env) {
  const response = await api.onRequestPost({ request, env });
  return { status: response.status, body: await response.json() };
}

test("valid submission is stored as pending with a server timestamp and no IP", async () => {
  const env = makeEnv();
  const res = await call(post(valid()), env);
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { ok: true });
  const rows = env.DB.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].topic, "transport");
  assert.equal(rows[0].rating, 5);
  assert.equal(rows[0].comment, "Very clear, thank you!");
  assert.equal(rows[0].moderation_status, "pending");
  assert.match(rows[0].created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["comment", "created_at", "id", "moderation_status", "rating", "topic"]);
  assert.ok(!JSON.stringify(rows[0]).includes("203.0.113.10"));
  assert.equal(turnstileCalls.length, 1);
  assert.ok(!turnstileCalls[0].body.includes("remoteip"), "IP is not sent to Turnstile");
});

test("example: İstanbulkart with rating 4 and no comment stores NULL comment", async () => {
  const env = makeEnv();
  const res = await call(post({ topic: "istanbulkart", rating: 4, website: "", turnstileToken: "token-ok" }), env);
  assert.equal(res.status, 201);
  const [row] = env.DB.rows();
  assert.equal(row.topic, "istanbulkart");
  assert.equal(row.rating, 4);
  assert.equal(row.comment, null);
});

test("blank or whitespace-only comment is stored as NULL, and comments are trimmed", async () => {
  const env = makeEnv();
  assert.equal((await call(post(valid({ comment: "   \n  " })), env)).status, 201);
  assert.equal((await call(post(valid({ comment: "  useful  ", rating: 3 }), { ip: "203.0.113.11" }), env)).status, 201);
  const rows = env.DB.rows();
  assert.equal(rows[0].comment, null);
  assert.equal(rows[1].comment, "useful");
});

test("invalid ratings are rejected and nothing is stored", async () => {
  const env = makeEnv();
  for (const rating of [0, 6, -1, 4.5, "4", null, true, [4]]) {
    api.resetRateLimiter();
    const res = await call(post(valid({ rating })), env);
    assert.equal(res.status, 400, `rating ${JSON.stringify(rating)}`);
    assert.equal(res.body.error, api.MESSAGES.rating);
  }
  const missing = valid();
  delete missing.rating;
  assert.equal((await call(post(missing), env)).status, 400);
  assert.equal(env.DB.rows().length, 0);
  assert.equal(turnstileCalls.length, 0, "Turnstile is not called for invalid input");
});

test("topics outside the allowlist are rejected", async () => {
  const env = makeEnv();
  for (const topic of ["İstanbulkart", "unknown", "../admin", "", 42, "__proto__", "constructor"]) {
    api.resetRateLimiter();
    const res = await call(post(valid({ topic })), env);
    assert.equal(res.status, 400, `topic ${JSON.stringify(topic)}`);
    assert.equal(res.body.error, api.MESSAGES.topic);
  }
  assert.equal(env.DB.rows().length, 0);
});

test("comment over 1000 characters is rejected; exactly 1000 is accepted", async () => {
  const env = makeEnv();
  const over = await call(post(valid({ comment: "a".repeat(1001) })), env);
  assert.equal(over.status, 400);
  assert.equal(over.body.error, api.MESSAGES.comment);
  const exact = await call(post(valid({ comment: "ş".repeat(1000) })), env);
  assert.equal(exact.status, 201);
  assert.equal([...env.DB.rows()[0].comment].length, 1000);
});

test("request body over 4 KB is rejected with 413", async () => {
  const env = makeEnv();
  const raw = JSON.stringify(valid({ comment: "x".repeat(5000) }));
  const res = await call(post(null, { raw }), env);
  assert.equal(res.status, 413);
  assert.equal(env.DB.rows().length, 0);
});

test("honeypot spam gets a fake success, is not stored, and skips Turnstile", async () => {
  const env = makeEnv();
  const res = await call(post(valid({ website: "https://spam.example" })), env);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(env.DB.rows().length, 0);
  assert.equal(turnstileCalls.length, 0);
});

test("failed, missing, wrong-action, or unreachable Turnstile verification is rejected", async () => {
  const env = makeEnv();
  turnstileResult = { success: false, "error-codes": ["invalid-input-response"] };
  let res = await call(post(valid()), env);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, api.MESSAGES.verification);

  api.resetRateLimiter();
  turnstileResult = { success: true, action: "some-other-form" };
  assert.equal((await call(post(valid()), env)).status, 403);

  api.resetRateLimiter();
  turnstileResult = "network-error";
  assert.equal((await call(post(valid()), env)).status, 403);

  api.resetRateLimiter();
  turnstileResult = { success: true };
  const noToken = valid();
  delete noToken.turnstileToken;
  assert.equal((await call(post(noToken), env)).status, 403);
  assert.equal(env.DB.rows().length, 0);
});

test("missing Turnstile secret or database returns 503 without storing", async () => {
  assert.equal((await call(post(valid()), makeEnv({ TURNSTILE_SECRET_KEY: undefined }))).status, 503);
  api.resetRateLimiter();
  const res = await call(post(valid()), makeEnv({ DB: undefined }));
  assert.equal(res.status, 503);
  assert.equal(res.body.error, api.MESSAGES.unavailable);
});

test("per-client rate limit: 6th request in 10 minutes from one client gets 429; others unaffected", async () => {
  const env = makeEnv();
  for (let i = 0; i < api.LIMITS.perClientMax; i++) {
    assert.equal((await call(post(valid()), env)).status, 201);
  }
  const limited = await call(post(valid()), env);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, api.MESSAGES.rateLimited);
  assert.equal((await call(post(valid(), { ip: "198.51.100.7" }), env)).status, 201);
  assert.equal(env.DB.rows().length, api.LIMITS.perClientMax + 1);
});

test("global flood guard: more than 30 submissions in a minute gets 429", async () => {
  const env = makeEnv();
  const insert = env.DB.raw.prepare("INSERT INTO student_feedback (topic, rating) VALUES ('general', 3)");
  for (let i = 0; i < api.LIMITS.globalMaxPerMinute; i++) insert.run();
  const res = await call(post(valid(), { ip: "192.0.2.99" }), env);
  assert.equal(res.status, 429);
  assert.equal(env.DB.rows().length, api.LIMITS.globalMaxPerMinute);
});

test("database failure returns a generic 500 message without leaking details", async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const res = await call(post(valid({ comment: "private comment text" })), makeEnv({ DB: brokenDb }));
    assert.equal(res.status, 500);
    assert.equal(res.body.error, api.MESSAGES.saveFailed);
    assert.ok(!JSON.stringify(res.body).includes("D1_ERROR"));
  } finally {
    console.error = original;
  }
  assert.ok(errors.length > 0);
  assert.ok(errors.every((line) => !line.includes("private comment text") && !line.includes("internal secret detail")));
});

test("malformed requests are rejected: wrong content type, bad JSON, arrays, unknown fields, cross-origin", async () => {
  const env = makeEnv();
  assert.equal((await call(post(valid(), { headers: { "Content-Type": "text/plain" } }), env)).status, 415);
  assert.equal((await call(post(null, { raw: "{not json" }), env)).status, 400);
  assert.equal((await call(post(null, { raw: "[1,2,3]" }), env)).status, 400);
  assert.equal((await call(post(valid({ email: "a@b.co" })), env)).status, 400);
  assert.equal((await call(post(valid({ ip: "1.2.3.4" })), env)).status, 400);
  assert.equal((await call(post(valid(), { headers: { Origin: "https://evil.example" } }), env)).status, 403);
  assert.equal(env.DB.rows().length, 0);
});

test("comments containing an email address or phone number are rejected", async () => {
  const env = makeEnv();
  for (const comment of ["write me at student@example.com", "call +90 555 123 45 67", "my number 05551234567"]) {
    api.resetRateLimiter();
    const res = await call(post(valid({ comment })), env);
    assert.equal(res.status, 400, comment);
    assert.equal(res.body.error, api.MESSAGES.personal);
  }
  api.resetRateLimiter();
  assert.equal((await call(post(valid({ comment: "Fare went from 22.55 TL to 46.20 TL in 2026" })), env)).status, 201);
});

test("public visitors cannot read stored submissions", async () => {
  // The feedback endpoint only handles POST. Pages answers other methods with 405.
  const exported = Object.keys(api).filter((name) => name.startsWith("onRequest"));
  assert.deepEqual(exported, ["onRequestPost"]);

  // A successful POST returns only {ok:true}, never stored data.
  const env = makeEnv();
  await call(post(valid({ comment: "secret opinion" })), env);
  const second = await call(post(valid({ topic: "budget", rating: 2 }), { ip: "198.51.100.8" }), env);
  assert.deepEqual(second.body, { ok: true });

  // The config endpoint returns only the public site key.
  const cfg = await configApi.onRequestGet({ env });
  const cfgBody = await cfg.json();
  assert.deepEqual(Object.keys(cfgBody), ["siteKey"]);
  assert.ok(!JSON.stringify(cfgBody).includes("test-secret"));
  assert.ok(!JSON.stringify(cfgBody).includes("secret opinion"));
  assert.equal(Object.keys(configApi).filter((n) => n.startsWith("onRequest")).join(), "onRequestGet");
  assert.equal((await configApi.onRequestGet({ env: {} })).status, 503);

  // Private project files are not served.
  for (const path of ["/functions/api/student-feedback/index.js", "/migrations/0001_create_student_feedback.sql", "/tests/student-feedback.test.mjs", "/tools/build-search-index.mjs", "/wrangler.d1.toml", "/.dev.vars", "/.dev.vars.example"]) {
    let nextCalled = false;
    const res = await middleware({ request: new Request(ORIGIN + path), next: async () => { nextCalled = true; return new Response("asset"); } });
    assert.equal(res.status, 404, path);
    assert.equal(nextCalled, false, path);
  }
  let passed = false;
  await middleware({ request: new Request(`${ORIGIN}/api/student-feedback`), next: async () => { passed = true; return new Response("ok"); } });
  assert.equal(passed, true, "API requests pass through the middleware");
});
