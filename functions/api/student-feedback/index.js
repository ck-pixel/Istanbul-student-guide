// POST /api/student-feedback — stores a private 1–5 star rating for a guide.
//
// Runs as a Cloudflare Pages Function. Needs:
//   DB                    D1 binding (table created by migrations/0001_create_student_feedback.sql)
//   TURNSTILE_SECRET_KEY  Turnstile secret, set as an encrypted secret in Pages settings
//
// Privacy: no IP address, name, email, or other identifier is stored. The client
// IP is used only in memory, hashed, for short-lived rate limiting.
// Only POST is exported, so the endpoint cannot be used to read submissions.

export const TOPICS = Object.freeze({
  "first-30-days": "Your first 30 days in Istanbul",
  "residence-permit": "Student residence permit",
  "university-registration": "University registration and enrollment",
  "registrations-after-arrival": "Essential registrations after arrival",
  "rental-agreements": "Rental agreements and checklist",
  istanbulkart: "Student İstanbulkart",
  housing: "Finding housing and rental contracts",
  transport: "Public transport in Istanbul",
  budget: "Build a student budget",
  general: "The site in general",
});

export const LIMITS = Object.freeze({
  maxBodyBytes: 4096,
  maxCommentChars: 1000,
  perClientMax: 5, // submissions per client...
  perClientWindowMs: 10 * 60 * 1000, // ...per 10 minutes
  globalMaxPerMinute: 30, // across all visitors, counted in the database
  turnstileTimeoutMs: 5000,
});

export const MESSAGES = Object.freeze({
  forbidden: "This request is not allowed.",
  unsupported: "Please send the form as JSON.",
  tooLarge: "Your submission is too large.",
  malformed: "Please check the form and try again.",
  topic: "Please choose a guide topic.",
  rating: "Please choose a rating from 1 to 5 stars.",
  comment: `Comments can be up to ${LIMITS.maxCommentChars} characters.`,
  personal: "Please remove email addresses and phone numbers from your comment.",
  verification: "We could not verify that you are human. Please try again.",
  rateLimited: "Too many submissions. Please try again later.",
  unavailable: "Feedback is not available right now. Please try again later.",
  saveFailed: "Sorry, your feedback could not be saved. Please try again later.",
});

const ALLOWED_KEYS = new Set(["topic", "rating", "comment", "website", "turnstileToken"]);
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "student-feedback";

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
const fail = (status, message) => json(status, { ok: false, error: message });

// ---------- Rate limiting (memory only, never persisted) ----------
// Each Cloudflare isolate keeps its own map, so this is a best-effort limit; the
// database-wide flood guard and Turnstile are the other layers.
const buckets = new Map();

export function resetRateLimiter() {
  buckets.clear();
}

async function clientKey(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`student-feedback:${ip}`));
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function allowClient(key, now) {
  if (!key) return true;
  const recent = (buckets.get(key) || []).filter((t) => now - t < LIMITS.perClientWindowMs);
  if (recent.length >= LIMITS.perClientMax) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 5000) {
    for (const [k, times] of buckets) if (times.every((t) => now - t >= LIMITS.perClientWindowMs)) buckets.delete(k);
  }
  return true;
}

// ---------- Request parsing ----------
async function readBody(request) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > LIMITS.maxBodyBytes) return { tooLarge: true };
  if (!request.body) return { text: "" };
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMITS.maxBodyBytes) {
      await reader.cancel();
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes) };
}

// ---------- Validation ----------
export function normalizeComment(value) {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== "string") return { error: MESSAGES.malformed };
  const cleaned = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (!cleaned) return { value: null };
  if ([...cleaned].length > LIMITS.maxCommentChars) return { error: MESSAGES.comment };
  if (/[^\s@]+@[^\s@]+\.[^\s@]{2,}/.test(cleaned) || /(?:\+?\d[\s.()-]?){10,}/.test(cleaned)) {
    return { error: MESSAGES.personal };
  }
  return { value: cleaned };
}

export function validate(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { error: MESSAGES.malformed };
  if (Object.keys(data).some((key) => !ALLOWED_KEYS.has(key))) return { error: MESSAGES.malformed };
  if (typeof data.topic !== "string" || !Object.hasOwn(TOPICS, data.topic)) return { error: MESSAGES.topic };
  if (typeof data.rating !== "number" || !Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5) {
    return { error: MESSAGES.rating };
  }
  const comment = normalizeComment(data.comment);
  if (comment.error) return { error: comment.error };
  return { topic: data.topic, rating: data.rating, comment: comment.value };
}

// ---------- Turnstile ----------
async function verifyTurnstile(token, secret) {
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.turnstileTimeoutMs);
  try {
    const response = await fetch(TURNSTILE_URL, {
      method: "POST",
      body: new URLSearchParams({ secret, response: token }),
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const result = await response.json();
    if (result.success !== true) return false;
    if (result.action && result.action !== TURNSTILE_ACTION) return false;
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Handler ----------
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return fail(403, MESSAGES.forbidden);

  const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return fail(415, MESSAGES.unsupported);

  const body = await readBody(request);
  if (body.tooLarge) return fail(413, MESSAGES.tooLarge);

  let data;
  try {
    data = JSON.parse(body.text);
  } catch {
    return fail(400, MESSAGES.malformed);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return fail(400, MESSAGES.malformed);

  // Honeypot: real visitors never see this field. Pretend success, store nothing.
  if (typeof data.website === "string" && data.website.trim() !== "") return json(200, { ok: true });

  if (!allowClient(await clientKey(request), Date.now())) return fail(429, MESSAGES.rateLimited);

  const input = validate(data);
  if (input.error) return fail(400, input.error);

  if (!env.TURNSTILE_SECRET_KEY || !env.DB) return fail(503, MESSAGES.unavailable);
  if (!(await verifyTurnstile(data.turnstileToken, env.TURNSTILE_SECRET_KEY))) return fail(403, MESSAGES.verification);

  try {
    const since = new Date(Date.now() - 60_000).toISOString();
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM student_feedback WHERE created_at >= ?1").bind(since).first();
    if (recent && Number(recent.n) >= LIMITS.globalMaxPerMinute) return fail(429, MESSAGES.rateLimited);

    await env.DB.prepare("INSERT INTO student_feedback (topic, rating, comment) VALUES (?1, ?2, ?3)")
      .bind(input.topic, input.rating, input.comment)
      .run();
  } catch (error) {
    // Log the error type only; never log the submission itself.
    console.error("student-feedback: database error", error && error.name);
    return fail(500, MESSAGES.saveFailed);
  }

  return json(201, { ok: true });
}
