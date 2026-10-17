// Pre-deploy site check. Exits with code 1 if anything is broken, so it can be used
// as (part of) the Cloudflare Pages build command to stop a broken commit going live:
//   node --test tests/ && node tools/check-site.mjs
// Checks: internal links and #anchors, images (files exist, alt text, width/height),
// page basics (title, description, canonical, exactly one <h1>), sitemap entries,
// JSON validity, CSS brace balance, and JavaScript syntax. No network access needed.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => path.relative(root, p).split(path.sep).join("/");
const problems = [];
const fail = (msg) => problems.push(msg);

const htmlFiles = [
  ...fs.readdirSync(root).filter((f) => f.endsWith(".html")).map((f) => path.join(root, f)),
  ...fs.readdirSync(path.join(root, "guides")).filter((f) => f.endsWith(".html")).map((f) => path.join(root, "guides", f)),
];
const idsByFile = new Map(htmlFiles.map((f) => [f, new Set([...fs.readFileSync(f, "utf8").matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))]));

let linkCount = 0;
let imageCount = 0;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  const name = rel(file);
  const dir = path.dirname(file);

  // Page basics (the 404 page is intentionally not indexed).
  if (!/<title>[^<]+<\/title>/.test(html)) fail(`${name}: missing <title>`);
  if (name !== "404.html") {
    if (!/<meta name="description" content="[^"]+"/.test(html)) fail(`${name}: missing meta description`);
    if (!/<link rel="canonical" href="https:\/\/[^"]+"/.test(html)) fail(`${name}: missing canonical URL`);
  }
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) fail(`${name}: expected exactly one <h1>, found ${h1}`);

  // Duplicate ids break anchors and accessibility.
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  for (const dup of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) fail(`${name}: duplicate id "${dup}"`);

  // Images.
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    imageCount++;
    if (!/\salt="/.test(tag)) fail(`${name}: <img> without alt attribute`);
    if (!/\swidth="\d+"/.test(tag) || !/\sheight="\d+"/.test(tag)) fail(`${name}: <img> without width/height`);
    const sources = [...tag.matchAll(/\s(?:src|srcset)="([^"]+)"/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().split(/\s+/)[0]));
    for (const src of sources) {
      if (/^(https?:|data:)/.test(src)) continue;
      const target = src.startsWith("/") ? path.join(root, src) : path.join(dir, src);
      if (!fs.existsSync(target)) fail(`${name}: missing image ${src}`);
    }
  }

  // Internal links and anchors.
  for (const [, raw] of html.matchAll(/\s(?:href|action)="([^"]+)"/g)) {
    linkCount++;
    const ref = raw.replace(/&amp;/g, "&");
    if (/^(https?:|\/\/|mailto:|tel:|data:)/.test(ref) || ref.startsWith("/api/")) continue;
    const [beforeHash, frag] = ref.split("#");
    const p = beforeHash.split("?")[0];
    const target = !p ? file : p.startsWith("/") ? path.join(root, p) : path.join(dir, p);
    if (!fs.existsSync(target)) fail(`${name}: broken link ${ref}`);
    else if (frag && target.endsWith(".html") && !idsByFile.get(path.normalize(target))?.has(frag)) fail(`${name}: missing anchor ${ref}`);
  }
}

// Sitemap entries must map to real pages.
const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>https:\/\/[^/]+\/([^<]*)<\/loc>/g)].map((m) => m[1]);
if (!locs.length) fail("sitemap.xml: no <loc> entries");
for (const loc of locs) {
  const file = loc === "" ? "index.html" : `${loc}.html`;
  if (!fs.existsSync(path.join(root, file))) fail(`sitemap.xml: ${loc || "/"} has no matching ${file}`);
}
if (!/Sitemap:\s*https:\/\/\S+\/sitemap\.xml/.test(fs.readFileSync(path.join(root, "robots.txt"), "utf8"))) fail("robots.txt: no Sitemap line");

// JSON files.
for (const f of ["search-index.json", "images/credits.json", "_routes.json"]) {
  try { JSON.parse(fs.readFileSync(path.join(root, f), "utf8")); } catch (e) { fail(`${f}: invalid JSON (${e.message})`); }
}

// CSS brace balance.
let depth = 0;
for (const ch of fs.readFileSync(path.join(root, "styles.css"), "utf8")) {
  if (ch === "{") depth++;
  if (ch === "}") depth--;
  if (depth < 0) break;
}
if (depth !== 0) fail("styles.css: unbalanced braces");

// JavaScript syntax (site scripts and Pages Functions).
const jsFiles = [
  ...fs.readdirSync(root).filter((f) => f.endsWith(".js")).map((f) => path.join(root, f)),
  ...fs.readdirSync(path.join(root, "functions"), { recursive: true }).filter((f) => String(f).endsWith(".js")).map((f) => path.join(root, "functions", String(f))),
];
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); } catch (e) { fail(`${rel(f)}: syntax error\n${String(e.stderr || e.message).trim().split("\n").slice(0, 3).join("\n")}`); }
}

const summary = `${htmlFiles.length} pages, ${linkCount} links, ${imageCount} images, ${locs.length} sitemap URLs, ${jsFiles.length} JS files`;
if (problems.length) {
  console.error(`Site check FAILED (${problems.length} problem${problems.length === 1 ? "" : "s"}) — ${summary}`);
  for (const p of problems) console.error(" - " + p);
  process.exit(1);
}
console.log(`Site check passed — ${summary}`);
