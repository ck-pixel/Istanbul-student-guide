// POST /api/feedback — stores an anonymous "Was this helpful?" vote.
// Runs as a Cloudflare Pages Function. Needs a D1 database bound as `DB`
// (Pages project > Settings > Bindings). No IP address or identifier is stored.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Forbidden." }, 403);
  if (!env.DB) return json({ error: "Feedback storage is not set up yet." }, 503);

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const page = typeof data.page === "string" ? data.page : "";
  if (!/^[a-z0-9/-]{1,80}$/.test(page) || typeof data.helpful !== "boolean") {
    return json({ error: "Invalid request." }, 400);
  }

  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, page TEXT NOT NULL, helpful INTEGER NOT NULL, created_at TEXT NOT NULL)"
  ).run();
  await env.DB.prepare("INSERT INTO feedback (page, helpful, created_at) VALUES (?, ?, ?)")
    .bind(page, data.helpful ? 1 : 0, new Date().toISOString())
    .run();

  return json({ ok: true });
}
