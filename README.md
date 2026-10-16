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
