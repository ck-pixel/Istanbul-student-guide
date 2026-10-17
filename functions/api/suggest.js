// POST /api/suggest — stores a correction or new-topic suggestion.
// Runs as a Cloudflare Pages Function. Needs a D1 database bound as `DB`
// (Pages project > Settings > Bindings) with migrations applied (see README).
// No IP address is stored; email is optional. Abuse protection: body-size cap,
// honeypot, per-client in-memory rate limit (hashed IP, never stored), site-wide cap.
// Works with JavaScript (JSON reply) and without it (redirect back to the form).

export const LIMITS = Object.freeze({
  maxBodyBytes: 8 * 1024,
  perClientMax: 5,
  perClientWindowMs: 10 * 60 * 1000,
  globalMaxPerMinute: 20,
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const TYPES = new Set(["correction", "topic"]);

// ---- Per-client rate limit (memory only; each Cloudflare isolate keeps its own copy) ----
const buckets = new Map();
export function resetRateLimiter() {
  buckets.clear();
}
async function clientKey(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`suggest:${ip}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
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

// ---- Read the body with a hard size cap ----
async function readBody(request) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > LIMITS.maxBodyBytes) return { tooLarge: true };
  if (!request.body) return { bytes: new Uint8Array(0) };
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
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { all.set(c, offset); offset += c.byteLength; }
  return { bytes: all };
}

export async function onRequestPost({ request, env }) {
  const wantsJson = (request.headers.get("Accept") || "").includes("application/json");
  const reply = (ok, error, status) => {
    if (wantsJson) return ok ? json({ ok: true }) : json({ error }, status);
    return Response.redirect(new URL(`/suggest.html?sent=${ok ? 1 : 0}`, request.url).toString(), 303);
  };

  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return reply(false, "Forbidden.", 403);
  if (!env.DB) return reply(false, "The suggestion form is not set up yet.", 503);

  const body = await readBody(request);
  if (body.tooLarge) return reply(false, "Your message is too large.", 413);

  let form;
  try {
    form = await new Response(body.bytes, { headers: { "Content-Type": request.headers.get("Content-Type") || "" } }).formData();
  } catch {
    return reply(false, "Invalid request.", 400);
  }

  // Spam trap: real visitors never see or fill this field.
  if (String(form.get("website") || "").trim()) return reply(true);

  if (!allowClient(await clientKey(request), Date.now())) {
    return reply(false, "Too many messages. Please try again later.", 429);
  }

  const type = String(form.get("type") || "");
  const page = String(form.get("page") || "general");
  const message = String(form.get("message") || "").trim();
  const email = String(form.get("email") || "").trim();

  if (!TYPES.has(type)) return reply(false, "Please choose what kind of message this is.", 400);
  if (!/^[a-z0-9/-]{1,80}$/.test(page)) return reply(false, "Please choose a page.", 400);
  if (message.length < 10 || message.length > 2000) return reply(false, "Please write between 10 and 2,000 characters.", 400);
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return reply(false, "Please check the email address or leave it empty.", 400);

  try {
    const since = new Date(Date.now() - 60 * 1000).toISOString();
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM suggestions WHERE created_at >= ?1").bind(since).first();
    if (recent && Number(recent.n) >= LIMITS.globalMaxPerMinute) {
      return reply(false, "Too many messages right now. Please try again in a minute.", 429);
    }
    await env.DB.prepare("INSERT INTO suggestions (type, page, message, email, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(type, page, message, email || null, new Date().toISOString())
      .run();
  } catch (error) {
    console.error("suggest: database error", error && error.name);
    return reply(false, "Sorry, your message could not be saved.", 500);
  }

  return reply(true);
}
