// GET /api/student-feedback/config — returns the PUBLIC Turnstile site key only.
// The secret key and all stored feedback stay on the server.
export function onRequestGet({ env }) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (!env.TURNSTILE_SITE_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "Feedback is not available right now." }), { status: 503, headers });
  }
  return new Response(JSON.stringify({ siteKey: env.TURNSTILE_SITE_KEY }), { status: 200, headers });
}
