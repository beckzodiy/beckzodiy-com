# beckzodiy.com

My aim, explained in 3D: **make sending money home to Uzbekistan cheap and instant, using legal stablecoins.**

A scroll story built with plain HTML + [three.js](https://threejs.org): a dotted globe, migrant money arcs, the old bank route, a data packet travelling Dubai → undersea fiber → Europe → Tashkent → Andijan, and a trip inside a fiber optic cable.

```bash
npm install
npm run build    # bundles src/main.js → public/app.js
npm run dev      # local preview
node scripts/globe-data.mjs   # regenerate src/geo.js (slow, ~8 min)
```

Every push to `main` deploys via `.github/workflows/deploy.yml`.

## Admin panel

`/admin` shows visitor stats: views, unique IPs, views per day, every IP with first/last seen, referrers and the latest visits (click an IP to see all its visits). Visits are logged by `worker/index.js` into a SQLite Durable Object and kept for 90 days. Opening `/admin` marks your browser so your own visits aren't counted.

Login is HTTP Basic auth (any username). Set the password once:

```bash
npx wrangler secret put ADMIN_PASSWORD
```

or in Cloudflare: Workers & Pages → beckzodiy-publisher → Settings → Variables and Secrets → Add → Secret `ADMIN_PASSWORD`.
For local dev put `ADMIN_PASSWORD=...` in `.dev.vars`.
