# beckzodiy.com publisher

A lightweight Telegraph-style publisher: a static, decoupled browser UI backed by a Hono REST API on Cloudflare Workers, D1 for articles, and R2 for images. Public article pages are rendered at the edge with SEO metadata.

## Cloudflare setup

```bash
npm install
npx wrangler login
npx wrangler d1 create beckzodiy-publisher
npx wrangler r2 bucket create beckzodiy-media
```

Copy the D1 `database_id` printed by the create command into `wrangler.toml`, then initialize the remote database and store the admin key:

```bash
npm run db:remote
npx wrangler secret put ADMIN_SECRET_KEY
npm run deploy
```

To attach `beckzodiy.com`, add a Worker custom domain in the Cloudflare dashboard (Workers & Pages → this Worker → Settings → Domains & Routes). Ensure the domain is active in the same Cloudflare account.

## Automatic deploys

Every push to `main` runs `.github/workflows/deploy.yml`, which typechecks and runs `wrangler deploy`. It needs one repository secret, `CLOUDFLARE_API_TOKEN` (GitHub → Settings → Secrets and variables → Actions), created from Cloudflare's **Edit Cloudflare Workers** token template.

## Local development

```bash
npm install
npm run db:local
printf 'ADMIN_SECRET_KEY="choose-a-local-secret"\n' > .dev.vars
npm run dev
```

The `.dev.vars` file is ignored by Git. Open `/admin1225` on the local URL and enter the same key. The key stays only in browser `localStorage` and is sent as a Bearer token for writes.

## API

- `GET /api/articles` and `GET /api/articles/:slug` are public.
- `POST /api/articles`, `PUT /api/articles/:slug`, `DELETE /api/articles/:slug`, and `POST /api/upload` require `Authorization: Bearer <ADMIN_SECRET_KEY>`.
- Images are capped at 10 MB and served through `/media/*` from the private R2 binding.
- `/sitemap.xml`, `/feed.xml` (RSS) and `/robots.txt` are generated dynamically.
- The home page (`/`, `/?q=…`, `/?page=N`) and article pages are server-rendered; `www` redirects to the apex domain.

## Views & dashboard

Each article page and the home page send one beacon to `POST /api/view` (`public/track.js`). Bots are ignored, and so are your own visits while you are logged in to `/admin1225`. The Worker keeps daily totals per page, unique visitors (salted per-day hash, no IPs stored, pruned after two days), and daily counts by country, referrer, device and browser. View counts appear on cards and article pages. `/admin1225` opens on a **Dashboard** tab (`public/stats.js`, data from `GET /api/admin/stats?days=7|30|90|365`). The stats tables create themselves on first request; no migration step is needed.

Article HTML is sanitized in the editor before saving. For a public multi-admin deployment, add server-side HTML sanitization and replace the shared secret with Cloudflare Access or an identity provider.
