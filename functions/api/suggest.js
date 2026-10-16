// POST /api/suggest — stores a correction or new-topic suggestion.
// Runs as a Cloudflare Pages Function. Needs a D1 database bound as `DB`
// (Pages project > Settings > Bindings). No IP address is stored; email is optional.
// Works with JavaScript (JSON reply) and without it (redirect back to the form).

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const TYPES = new Set(["correction", "topic"]);

export async function onRequestPost({ request, env }) {
  const wantsJson = (request.headers.get("Accept") || "").includes("application/json");
  const reply = (ok, error, status) => {
    if (wantsJson) return ok ? json({ ok: true }) : json({ error }, status);
    return Response.redirect(new URL(`/suggest.html?sent=${ok ? 1 : 0}`, request.url).toString(), 303);
  };

  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return reply(false, "Forbidden.", 403);
  if (!env.DB) return reply(false, "The suggestion form is not set up yet.", 503);

  let form;
  try {
    form = await request.formData();
  } catch {
    return reply(false, "Invalid request.", 400);
  }

  // Spam trap: real visitors never see or fill this field.
  if (String(form.get("website") || "").trim()) return reply(true);

  const type = String(form.get("type") || "");
  const page = String(form.get("page") || "general");
  const message = String(form.get("message") || "").trim();
  const email = String(form.get("email") || "").trim();

  if (!TYPES.has(type)) return reply(false, "Please choose what kind of message this is.", 400);
  if (!/^[a-z0-9/-]{1,80}$/.test(page)) return reply(false, "Please choose a page.", 400);
  if (message.length < 10 || message.length > 2000) return reply(false, "Please write between 10 and 2,000 characters.", 400);
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return reply(false, "Please check the email address or leave it empty.", 400);

  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, page TEXT NOT NULL, message TEXT NOT NULL, email TEXT, created_at TEXT NOT NULL)"
  ).run();
  await env.DB.prepare("INSERT INTO suggestions (type, page, message, email, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(type, page, message, email || null, new Date().toISOString())
    .run();

  return reply(true);
}
