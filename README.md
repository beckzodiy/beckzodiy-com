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

## Local development

```bash
npm install
npm run db:local
printf 'ADMIN_SECRET_KEY="choose-a-local-secret"\n' > .dev.vars
npm run dev
```

The `.dev.vars` file is ignored by Git. Open the local URL, select **Admin**, and enter the same key. The key stays only in browser `localStorage` and is sent as a Bearer token for writes.

## API

- `GET /api/articles` and `GET /api/articles/:slug` are public.
- `POST /api/articles`, `PUT /api/articles/:slug`, `DELETE /api/articles/:slug`, and `POST /api/upload` require `Authorization: Bearer <ADMIN_SECRET_KEY>`.
- Images are capped at 10 MB and served through `/media/*` from the private R2 binding.
- `/sitemap.xml` and `/robots.txt` are generated dynamically.

Article HTML is sanitized in the editor before saving. For a public multi-admin deployment, add server-side HTML sanitization and replace the shared secret with Cloudflare Access or an identity provider.
