// Tests for the "Was this helpful?" API and the correction/topic form API.
// Run from the project folder:  node --test tests/
// Uses an in-memory SQLite database built from the real migration.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as feedback from "../functions/api/feedback.js";
import * as suggest from "../functions/api/suggest.js";

const MIGRATION = fs.readFileSync(new URL("../migrations/0002_feedback_and_suggestions.sql", import.meta.url), "utf8");
const ORIGIN = "https://istanbul-student-guide.pages.dev";

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(MIGRATION);
  return {
    count: (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
    insertOld: (table, n) => {
      const now = new Date().toISOString();
      for (let i = 0; i < n; i++) {
        if (table === "feedback") db.prepare("INSERT INTO feedback (page, helpful, created_at) VALUES (?, ?, ?)").run("guides/budget", 1, now);
        else db.prepare("INSERT INTO suggestions (type, page, message, email, created_at) VALUES (?, ?, ?, ?, ?)").run("topic", "general", "A seeded message", null, now);
      }
    },
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
    const fail = async () => { throw Object.assign(new Error("D1_ERROR: secret detail"), { name: "D1Error" }); };
    return { bind() { return this; }, run: fail, first: fail };
  },
};

beforeEach(() => {
  feedback.resetRateLimiter();
  suggest.resetRateLimiter();
});

const vote = (body, ip = "203.0.113.5", extra = {}) =>
  new Request(`${ORIGIN}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": ip, ...extra },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

function form(fields, ip = "203.0.113.9", accept = "application/json") {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request(`${ORIGIN}/api/suggest`, { method: "POST", headers: { Origin: ORIGIN, Accept: accept, "CF-Connecting-IP": ip }, body: fd });
}
const goodSuggestion = { type: "correction", page: "guides/housing", message: "The İGDAŞ link has moved to a new page." };

// ---------------- /api/feedback ----------------
test("feedback: valid vote is stored", async () => {
  const env = { DB: makeDb() };
  const res = await feedback.onRequestPost({ request: vote({ page: "guides/istanbulkart", helpful: true }), env });
  assert.equal(res.status, 200);
  assert.equal(env.DB.count("feedback"), 1);
});

test("feedback: invalid page or helpful value is rejected and nothing stored", async () => {
  const env = { DB: makeDb() };
  for (const body of [{ page: "<script>", helpful: true }, { page: "guides/x", helpful: "yes" }, "not json", "null"]) {
    const res = await feedback.onRequestPost({ request: vote(body), env });
    assert.equal(res.status, 400);
  }
  assert.equal(env.DB.count("feedback"), 0);
});

test("feedback: oversized body is rejected with 413", async () => {
  const env = { DB: makeDb() };
  const res = await feedback.onRequestPost({ request: vote({ page: "guides/budget", helpful: true, pad: "x".repeat(2000) }), env });
  assert.equal(res.status, 413);
  assert.equal(env.DB.count("feedback"), 0);
});

test("feedback: cross-site Origin is rejected", async () => {
  const env = { DB: makeDb() };
  const res = await feedback.onRequestPost({ request: vote({ page: "guides/budget", helpful: true }, "203.0.113.5", { Origin: "https://evil.example" }), env });
  assert.equal(res.status, 403);
});

test("feedback: per-client rate limit returns 429; another client is unaffected", async () => {
  const env = { DB: makeDb() };
  for (let i = 0; i < feedback.LIMITS.perClientMax; i++) {
    assert.equal((await feedback.onRequestPost({ request: vote({ page: "guides/budget", helpful: true }), env })).status, 200);
  }
  assert.equal((await feedback.onRequestPost({ request: vote({ page: "guides/budget", helpful: true }), env })).status, 429);
  assert.equal((await feedback.onRequestPost({ request: vote({ page: "guides/budget", helpful: true }, "198.51.100.7"), env })).status, 200);
});

test("feedback: site-wide per-minute cap returns 429", async () => {
  const env = { DB: makeDb() };
  env.DB.insertOld("feedback", feedback.LIMITS.globalMaxPerMinute);
  const res = await feedback.onRequestPost({ request: vote({ page: "guides/budget", helpful: true }), env });
  assert.equal(res.status, 429);
});

test("feedback: database failure returns a safe 500 without internal details", async () => {
  const res = await feedback.onRequestPost({ request: vote({ page: "guides/budget", helpful: true }), env: { DB: brokenDb } });
  assert.equal(res.status, 500);
  assert.ok(!(await res.text()).includes("secret"));
});

test("feedback: missing database returns 503", async () => {
  const res = await feedback.onRequestPost({ request: vote({ page: "guides/budget", helpful: true }), env: {} });
  assert.equal(res.status, 503);
});

test("feedback and suggest expose only POST (no way to read submissions)", () => {
  for (const mod of [feedback, suggest]) {
    assert.equal(typeof mod.onRequestPost, "function");
    for (const name of ["onRequest", "onRequestGet", "onRequestPut", "onRequestPatch", "onRequestDelete"]) assert.equal(mod[name], undefined);
  }
});

// ---------------- /api/suggest ----------------
test("suggest: valid suggestion is stored", async () => {
  const env = { DB: makeDb() };
  const res = await suggest.onRequestPost({ request: form(goodSuggestion), env });
  assert.equal(res.status, 200);
  assert.equal(env.DB.count("suggestions"), 1);
});

test("suggest: honeypot pretends success but stores nothing", async () => {
  const env = { DB: makeDb() };
  const res = await suggest.onRequestPost({ request: form({ ...goodSuggestion, website: "http://spam.example" }), env });
  assert.equal(res.status, 200);
  assert.equal(env.DB.count("suggestions"), 0);
});

test("suggest: oversized body is rejected with 413", async () => {
  const env = { DB: makeDb() };
  const res = await suggest.onRequestPost({ request: form({ ...goodSuggestion, message: "x".repeat(9000) }), env });
  assert.equal(res.status, 413);
  assert.equal(env.DB.count("suggestions"), 0);
});

test("suggest: validation errors are rejected", async () => {
  const env = { DB: makeDb() };
  for (const bad of [{ ...goodSuggestion, type: "other" }, { ...goodSuggestion, page: "../etc" }, { ...goodSuggestion, message: "short" }, { ...goodSuggestion, email: "not-an-email" }]) {
    assert.equal((await suggest.onRequestPost({ request: form(bad), env })).status, 400);
  }
  assert.equal(env.DB.count("suggestions"), 0);
});

test("suggest: per-client rate limit returns 429", async () => {
  const env = { DB: makeDb() };
  for (let i = 0; i < suggest.LIMITS.perClientMax; i++) {
    assert.equal((await suggest.onRequestPost({ request: form(goodSuggestion), env })).status, 200);
  }
  assert.equal((await suggest.onRequestPost({ request: form(goodSuggestion), env })).status, 429);
});

test("suggest: site-wide per-minute cap returns 429", async () => {
  const env = { DB: makeDb() };
  env.DB.insertOld("suggestions", suggest.LIMITS.globalMaxPerMinute);
  assert.equal((await suggest.onRequestPost({ request: form(goodSuggestion), env })).status, 429);
});

test("suggest: without JavaScript the form redirects back with a status", async () => {
  const env = { DB: makeDb() };
  const res = await suggest.onRequestPost({ request: form(goodSuggestion, "203.0.113.20", "text/html"), env });
  assert.equal(res.status, 303);
  assert.match(res.headers.get("Location"), /suggest\.html\?sent=1$/);
});

test("suggest: database failure returns a safe 500", async () => {
  const res = await suggest.onRequestPost({ request: form(goodSuggestion), env: { DB: brokenDb } });
  assert.equal(res.status, 500);
  assert.ok(!(await res.text()).includes("secret"));
});
