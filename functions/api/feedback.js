// POST /api/feedback — stores an anonymous "Was this helpful?" vote.
// Runs as a Cloudflare Pages Function. Needs a D1 database bound as `DB`
// (Pages project > Settings > Bindings) with migrations applied (see README).
// No IP address or identifier is stored. Abuse protection: body-size cap,
// per-client in-memory rate limit (hashed IP, never stored), site-wide cap.

export const LIMITS = Object.freeze({
  maxBodyBytes: 1024,
  perClientMax: 20,
  perClientWindowMs: 10 * 60 * 1000,
  globalMaxPerMinute: 120,
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// ---- Per-client rate limit (memory only; each Cloudflare isolate keeps its own copy) ----
const buckets = new Map();
export function resetRateLimiter() {
  buckets.clear();
}
async function clientKey(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`feedback:${ip}`));
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
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { all.set(c, offset); offset += c.byteLength; }
  return { text: new TextDecoder().decode(all) };
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Forbidden." }, 403);
  if (!env.DB) return json({ error: "Feedback storage is not set up yet." }, 503);

  const body = await readBody(request);
  if (body.tooLarge) return json({ error: "Request too large." }, 413);

  let data;
  try {
    data = JSON.parse(body.text);
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const page = data && typeof data.page === "string" ? data.page : "";
  if (!/^[a-z0-9/-]{1,80}$/.test(page) || typeof data.helpful !== "boolean") {
    return json({ error: "Invalid request." }, 400);
  }

  if (!allowClient(await clientKey(request), Date.now())) {
    return json({ error: "Too many answers. Please try again later." }, 429);
  }

  try {
    const since = new Date(Date.now() - 60 * 1000).toISOString();
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE created_at >= ?1").bind(since).first();
    if (recent && Number(recent.n) >= LIMITS.globalMaxPerMinute) {
      return json({ error: "Too many answers right now. Please try again in a minute." }, 429);
    }
    await env.DB.prepare("INSERT INTO feedback (page, helpful, created_at) VALUES (?1, ?2, ?3)")
      .bind(page, data.helpful ? 1 : 0, new Date().toISOString())
      .run();
  } catch (error) {
    console.error("feedback: database error", error && error.name);
    return json({ error: "Sorry, your answer could not be saved." }, 500);
  }

  return json({ ok: true });
}
