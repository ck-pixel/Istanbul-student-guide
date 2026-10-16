// Rebuilds search-index.json for the Student Life search box.
// Run from the project folder after adding or editing a guide:
//   node tools/build-search-index.mjs
// It reads each guide's description, h2/h3 headings, and optional
// <meta name="search-keywords" content="..."> (useful for Turkish terms).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const meta = (html, name) => (html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`)) || [])[1] || "";

const entries = fs.readdirSync(path.join(root, "guides"))
  .filter((file) => file.endsWith(".html"))
  .sort()
  .map((file) => {
    const html = fs.readFileSync(path.join(root, "guides", file), "utf8");
    const headings = [...html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g)].map((m) => strip(m[1])).join(" · ");
    return {
      href: `guides/${file}`,
      title: strip((html.match(/<title>([^<]*)<\/title>/) || [])[1] || file),
      headings: `${strip(meta(html, "description"))} ${headings}`.trim(),
      keywords: strip(meta(html, "search-keywords")),
    };
  });

fs.writeFileSync(path.join(root, "search-index.json"), JSON.stringify(entries, null, 2) + "\n");
console.log(`search-index.json: ${entries.length} guides`);
