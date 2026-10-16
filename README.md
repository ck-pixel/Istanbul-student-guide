# Istanbul Student Guide — starter project

A responsive, static website starter for an independent guide to student life in Istanbul.

## Included
- Responsive homepage and navigation
- Three initial guide pages: transport, budgeting, and renting
- About, privacy-template, and advertising-disclosure pages
- Inactive sponsor placeholder (no ad scripts or affiliate links)
- Basic page metadata and accessible navigation behavior

## Run locally
You can open `index.html` in a browser, or use a local static server from this folder (needs Node.js):
```bash
npx --yes serve@14.2.4 . -l 8000
```
Then visit `http://localhost:8000`. If you have Python instead, `python -m http.server 8000` also works.

## Deployment files
- `_headers`: security headers and a Content Security Policy, applied by Cloudflare Pages. If you add analytics, ads, embeds, or other third-party scripts, add their domains to the policy or the browser will block them.
- `404.html`: shown by Cloudflare Pages for missing pages.
- `robots.txt` and `sitemap.xml`: help search engines find the pages. **Both assume the address `https://istanbul-student-guide.pages.dev`.** Replace it with your real domain before launch, and add any new page to `sitemap.xml`.
- `favicon.svg`: the browser tab icon.

## Publish for free (GitHub + Cloudflare Pages)
The repository root must be **this folder** (the one containing `index.html`), not its parent.

### 1. Put the code on GitHub
1. Sign in at https://github.com and choose **New repository**. Name it `istanbul-student-guide`, leave "Add a README" unticked, and select **Create repository**. Public or private both work with Cloudflare Pages.
2. In a terminal opened in this folder, run:
   ```bash
   git init
   git add .
   git commit -m "Initial site"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/istanbul-student-guide.git
   git push -u origin main
   ```
   Replace `YOUR-USERNAME` with your GitHub username. Without Git, use **uploading an existing file** on the empty repository page and drag in every file and the `guides` folder.

### 2. Connect Cloudflare Pages
1. Sign in at https://dash.cloudflare.com, open **Workers & Pages**, choose **Create**, then the **Pages** tab and **Connect to Git** (wording may differ slightly as Cloudflare updates its dashboard).
2. Authorise GitHub and pick the `istanbul-student-guide` repository.
3. Build settings: **Framework preset** `None`, **Build command** empty, **Build output directory** `/`.
4. Select **Save and Deploy**. Your site appears at `https://<project-name>.pages.dev`.
5. If that address is not `https://istanbul-student-guide.pages.dev`, update `robots.txt` and `sitemap.xml`, commit, and push; Cloudflare redeploys automatically on every push to `main`.

### 3. Check the live site
- Open each page on desktop and mobile.
- Visit a made-up URL such as `/test-404` and confirm the 404 page appears.
- In browser developer tools, confirm the Console shows no errors (this checks the Content Security Policy in `_headers`).
- Cloudflare serves pages without `.html` (for example `/about`) and redirects `.html` links there. This is expected.

Cloudflare's free plan includes Pages hosting; you do not need a paid plan or a custom domain to launch.

Provider interfaces can change; follow current official documentation.

## Before launch
- Replace starter copy with researched, original articles and verified official links.
- Add a real publisher contact method.
- Review privacy, cookie, consumer-protection, advertising, and tax requirements that apply in Türkiye.
- Do not add analytics, forms, ad scripts, or affiliate links until you understand their data and policy implications.
- Keep paid placements clearly labelled. Never fabricate sponsors, testimonials, traffic, or revenue.
- Ad networks review the real site and may reject it. Approval and income are not guaranteed.

## Monetization roadmap
1. Publish useful original content and keep it updated.
2. Build genuine traffic through search, relevant communities, and useful social posts (no spam or purchased traffic).
3. Consider affiliate programs only after checking eligibility, payout availability, and terms for Türkiye.
4. Apply to an ad network when the site has sufficient original content and complies with its policies.
5. Offer sponsored listings only after you have a real audience or demonstrable value, and label them clearly.

This starter project is a foundation, not a completed business or legal-compliance package.

## International Student Life section
- `student-life.html` is the hub, with search and category filters. The six guides live in `guides/`.
- `student.js` runs the search, the "Was this helpful?" buttons, the saved checklists, and the suggestion form.
- `suggest.html` is the correction and new-topic form.
- `functions/api/feedback.js` and `functions/api/suggest.js` are Cloudflare Pages Functions that store answers and suggestions in a free Cloudflare D1 database.
- After editing or adding a guide, rebuild the search index with `node tools/build-search-index.mjs`, then commit `search-index.json`.
- Every guide shows a "Last verified" date. When you re-check a guide against its official sources, update that date (the `<time datetime="…">` near the top of the page) and the `lastmod` in `sitemap.xml`.

### Preview locally
Static pages only (search, checklists, and layout work; feedback and the form show an error because there is no server):
```bash
npx --yes serve@14.2.4 . -l 8000
```
Full preview including feedback and the form, using Cloudflare's local dev server and a local test database:
```bash
npx --yes wrangler@4.20.0 pages dev . --d1 DB=local-dev --port 8788
```
Then open `http://127.0.0.1:8788/student-life`. Test data is stored in `.wrangler/` (ignored by Git).

### Turn on feedback storage on Cloudflare (one time, free)
1. In the Cloudflare dashboard, open **Storage & Databases → D1** and create a database, for example `istanbul-student-guide`.
2. Open **Workers & Pages →** your Pages project **→ Settings → Bindings → Add → D1 database**. Set the variable name to `DB` and select the new database. Add it for Production (and Preview if you want).
3. Redeploy (push a commit, or use **Deployments → Retry deployment**). Tables are created automatically on first use.
4. Read submissions in **D1 → your database → Console**:
   ```sql
   SELECT * FROM suggestions ORDER BY created_at DESC;
   SELECT page, SUM(helpful) AS yes, COUNT(*) - SUM(helpful) AS no FROM feedback GROUP BY page;
   ```
Until the binding exists, the buttons and the form show a polite "could not be saved" message; nothing else breaks.

## Rate a guide (star ratings)
`feedback.html` lets visitors rate a guide from 1 to 5 stars with an optional comment (up to 1,000 characters). No account, name, email, phone, passport, residence permit, or location is collected.

How it works:
- `feedback.js` loads the public Turnstile site key from `GET /api/student-feedback/config`, shows the Cloudflare Turnstile spam check, and sends `{topic, rating, comment, website, turnstileToken}`.
- `functions/api/student-feedback/index.js` (POST only) checks, in order: same-site origin, JSON content type, 4 KB body limit, valid JSON with no unknown fields, the honeypot field (`website`, silently ignored if filled), a per-client rate limit, the topic allowlist, an integer rating from 1 to 5, the comment (trimmed, at most 1,000 characters, no email addresses or phone numbers), Turnstile verification, and a site-wide limit of 30 submissions per minute. It then saves the row with a parameterized query. Errors return short, safe messages.
- `migrations/0001_create_student_feedback.sql` creates the private `student_feedback` table: `id`, `topic`, `rating`, `comment`, `moderation_status` (default `pending`), and `created_at` (set by the database). There is no IP column.
- **There is no public way to read submissions.** The API only accepts POST, and `_routes.json` + `functions/_middleware.js` return 404 for `/functions`, `/migrations`, `/tests`, `/tools`, `/wrangler.d1.toml`, and `.dev.vars` files.

### Cloudflare setup (one time, free tier)
1. **Database.** If you have not already: Cloudflare dashboard → **Storage & Databases → D1 → Create** `istanbul-student-guide`. Then in your Pages project → **Settings → Bindings → Add → D1 database**, variable name `DB`.
2. **Create the table.** Copy the database ID from the D1 page into `database_id` in `wrangler.d1.toml`, then run:
   ```bash
   npx --yes wrangler@4.20.0 login
   npx --yes wrangler@4.20.0 d1 migrations apply istanbul-student-guide --remote -c wrangler.d1.toml
   ```
3. **Turnstile.** Dashboard → **Turnstile → Add widget**: name it, add hostname `istanbul-student-guide.pages.dev` (and any custom domain), widget mode **Managed**. Copy the site key and the secret key.
4. **Keys.** Pages project → **Settings → Variables and Secrets** (Production):
   - `TURNSTILE_SITE_KEY` = the site key (type: Text; it is public).
   - `TURNSTILE_SECRET_KEY` = the secret key (type: **Secret**; never put it in a file or in Git).
5. Redeploy (push a commit, or **Deployments → Retry deployment**).

### Reviewing feedback (admin only)
Only people with access to your Cloudflare account can read ratings. Use **D1 → istanbul-student-guide → Console**, or Wrangler while logged in:
```bash
npx --yes wrangler@4.20.0 d1 execute istanbul-student-guide --remote -c wrangler.d1.toml --command "SELECT id, topic, rating, comment, moderation_status, created_at FROM student_feedback WHERE moderation_status = 'pending' ORDER BY created_at DESC LIMIT 50"
npx --yes wrangler@4.20.0 d1 execute istanbul-student-guide --remote -c wrangler.d1.toml --command "SELECT topic, COUNT(*) AS ratings, ROUND(AVG(rating), 2) AS average FROM student_feedback WHERE moderation_status != 'spam' GROUP BY topic"
npx --yes wrangler@4.20.0 d1 execute istanbul-student-guide --remote -c wrangler.d1.toml --command "UPDATE student_feedback SET moderation_status = 'approved' WHERE id = 1"
```
Allowed statuses: `pending`, `approved`, `rejected`, `spam`. Nothing is ever published automatically.

### Limits of the rate limiting
The per-client limit (5 submissions per 10 minutes) uses the visitor's IP address only in memory, hashed, and never writes it to the database. That makes it best-effort:
- Cloudflare runs many copies of the function in different data centres, and each copy has its own memory, which is also cleared when the copy restarts. A determined sender can exceed the limit.
- Many students can share one IP address (university Wi-Fi, mobile carriers), so the limit is kept generous to avoid blocking real students.
- Visitors can change IP addresses (mobile networks, IPv6, VPNs).
Turnstile and the database-wide limit of 30 submissions per minute are the main protection. If you later move to a custom domain, a Cloudflare WAF rate-limiting rule for `/api/student-feedback` adds an edge-level limit without storing anything in your database.

### Testing locally
Automated tests (Node 22.5 or newer; no packages to install):
```bash
node --test "tests/*.test.mjs"
```
End-to-end with Cloudflare's local server and Turnstile **test** keys:
```bash
cp .dev.vars.example .dev.vars
npx --yes wrangler@4.20.0 d1 migrations apply istanbul-student-guide --local -c wrangler.d1.toml
npx --yes wrangler@4.20.0 pages dev . --d1 DB=local-dev --port 8788
```
Open `http://127.0.0.1:8788/feedback`. Check a saved record without printing comment text:
```bash
npx --yes wrangler@4.20.0 d1 execute istanbul-student-guide --local -c wrangler.d1.toml --command "SELECT id, topic, rating, length(comment) AS comment_chars, moderation_status, created_at FROM student_feedback ORDER BY id DESC LIMIT 5"
```
To test a failed Turnstile check, set `TURNSTILE_SECRET_KEY=2x0000000000000000000000000000000AA` in `.dev.vars` and restart the server. Locally, the per-client rate limit only applies when a request carries a `CF-Connecting-IP` header (Cloudflare adds it in production), for example `curl -H "CF-Connecting-IP: 198.51.100.1" ...`. Local test data stays in `.wrangler/` and is never uploaded.
