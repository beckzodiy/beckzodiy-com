# beckzodiy.com

A useless, fun, scroll-driven 3D website. Plain HTML + [three.js](https://threejs.org) (vendored in `public/vendor`), served as static assets on Cloudflare Workers.

```bash
npm install
npm run dev      # local preview
npm run deploy   # manual deploy
```

Every push to `main` deploys via `.github/workflows/deploy.yml` (needs the `CLOUDFLARE_API_TOKEN` repo secret).
