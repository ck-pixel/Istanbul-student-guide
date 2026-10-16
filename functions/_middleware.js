// Keeps project files that are not part of the website (database migrations,
// tests, maintenance tools, local config) from being served publicly.
// _routes.json limits this middleware to /api/* and these paths, so normal
// pages are served directly as static files without running any code.
export const PRIVATE_PATHS = [
  /^\/functions(\/|$)/,
  /^\/migrations(\/|$)/,
  /^\/tests(\/|$)/,
  /^\/tools(\/|$)/,
  /^\/wrangler\.d1(\.toml)?$/,
  /^\/\.dev\.vars/,
];

export async function onRequest({ request, next }) {
  const { pathname } = new URL(request.url);
  if (PRIVATE_PATHS.some((pattern) => pattern.test(pathname))) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  return next();
}
