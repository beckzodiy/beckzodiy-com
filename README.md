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
