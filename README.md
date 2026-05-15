# End Partisan Gerrymandering Project — site

A static, deployable demonstration of algorithmic congressional redistricting.

Three pages, all client-rendered:

- `/` — interactive dashboard. ReCom Markov chain draws all 435 congressional districts across all 50 states from real county/tract geography. Click any state to drop into a tract-level zoom.
- `/methodology` — technical overview, citations, data sources.
- `/legislation` — proposed federal statute + constitutional amendment.

The dashboard supports **seven presidential election years** (2000, 2004, 2008, 2012, 2016, 2020, 2024) with **real county-level returns** from the MIT Election Data and Science Lab via the [stiles/presidential-elections](https://github.com/stiles/presidential-elections) compilation. Switching years is instant (the partition is year-independent; only the per-district vote tallies change).

Population variance is shown in the UI in real time:

- **National view** (county-fragment substrate): typically ±5 % in 25–30 of the 44 multi-seat states, with worse outliers in California / Texas / New York / Pennsylvania where county granularity is too coarse for tight balance.
- **State-detail view** (tract substrate, opens on state click): consistently within ±1 % across all states. This is the substrate the algorithm uses to meet the legal target.

---

## Quick deploy to Netlify (free)

The site is a Next.js static export — fully pre-rendered HTML/JS/JSON, no server required. Same flow works on Vercel / Cloudflare Pages / GitHub Pages / S3 + CloudFront.

### 1. Prerequisites

- Node.js 20+ (Netlify defaults to it; locally use 20.x or newer)
- A GitHub account
- A Netlify account (or Vercel / your preferred host)

### 2. Build locally to confirm

```bash
cd site
npm install
npm run build         # static output → out/
npx serve out         # quick smoke check at http://localhost:3000
```

The first dashboard load fetches the county topojson from jsDelivr (~5 MB), seven year vote files from `/data/votes/` (~80 KB each), and a populations file (~45 KB). Clicking a state lazily fetches that state's tract topojson from `/data/tracts/` (29 MB total across all 51 files).

### 3. Push to GitHub

```bash
git init
git add .
git commit -m "Initial site"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/neutral-districting.git
git push -u origin main
```

### 4. Connect to Netlify

- New site → Import from GitHub → pick the repo
- Build command: `npm run build` (auto-detected)
- Publish directory: `out` (auto-detected from `netlify.toml`)
- Deploy

Every `git push` to `main` triggers a redeploy. The first build takes ~90 seconds.

### 5. Optional: custom domain

In Netlify, Site settings → Domain management → Add a domain. Netlify gives you a CNAME or A-record to set at your registrar (Cloudflare Registrar is cheap, no markup). SSL is auto-provisioned in 1–30 minutes.

---

## Refreshing the data

Vote data is built from a single open source — the MIT EDSL countypres dataset, accessed via the [stiles/presidential-elections](https://github.com/stiles/presidential-elections) processed JSON.

To regenerate the per-year files:

```bash
node scripts/build-historical-votes.mjs
```

This reads `data-cache/stiles_county.json` (downloaded once on first run, then cached) and writes `public/data/votes/<YEAR>.json` for each year we cover. The 2016/2020/2024 files are preserved as-is — they were sourced separately and verified to match published official totals.

---

## What this dashboard does NOT cover

**Midterm House election years (2006, 2010, 2014, 2018, 2022) are not included.** U.S. House results are reported by congressional district, not county, and counties can be split between multiple districts. There is no unified national county-level dataset for U.S. House returns. Adding midterms would require aggregating the MIT EDSL precinct-level dataset (2016+) up to the county level via a precinct→county crosswalk — a separate data-engineering effort.

**The county-level national view is approximate.** Many states (CA, TX, NY, NJ, PA, OH, NV, AZ) can't be balanced to within ±5 % using counties + slab-cut fragments alone, because a small number of metropolitan counties dominate the population. The state-detail view, which uses 2020 Decennial Census tracts (~3,500 people each), achieves ±1 % balance for those states.

**Districts are drawn using the actual ReCom algorithm with a public seed** (default seed = 42, reseedable in the UI). The implementation follows DeFord–Duchin–Solomon (2021). Different seeds produce different valid neutral maps — that's the point. There is no single "fair" map; there is a *distribution* of valid maps and a published seed picks one reproducibly.

---

## Repo layout

```
site/
├── app/                      # Next.js routes
│   ├── page.tsx              # / (dashboard)
│   ├── methodology/page.tsx  # /methodology
│   └── legislation/page.tsx  # /legislation
├── components/
│   ├── Dashboard.jsx         # the big one — ReCom + map renderer
│   ├── Nav.tsx
│   ├── Footer.tsx
│   └── Prose.tsx
├── content/
│   ├── methodology.md
│   └── legislation.md
├── public/
│   └── data/
│       ├── populations.json     # 2020 Decennial P1 county pops (3,143 counties)
│       ├── votes/
│       │   ├── 2000.json        # county-level D/R/total per year
│       │   ├── 2004.json
│       │   ├── 2008.json
│       │   ├── 2012.json
│       │   ├── 2016.json
│       │   ├── 2020.json
│       │   └── 2024.json
│       └── tracts/
│           ├── 01.json          # per-state 2020 tract topojson + P1 pops
│           ├── 02.json
│           └── ... (51 files, ~29 MB total)
├── scripts/
│   ├── build-historical-votes.mjs
│   └── transform-dashboard.mjs  # one-shot transform used to convert
│                                # the inline-data Dashboard into the
│                                # dynamic-load version. Idempotent.
├── data-cache/
│   └── stiles_county.json       # cached upstream source for refresh
├── netlify.toml
├── next.config.mjs              # output: 'export'
├── package.json
└── README.md
```

---

## Local development

```bash
npm install
npm run dev         # http://localhost:3000, hot-reloading
```

Note: `npm run dev` uses Next.js's dev server, which exercises the same code paths as the production build, but with React StrictMode double-mount. The first ReCom run can therefore take ~2× as long in dev as in prod.

For a production-mode preview:

```bash
npm run build
npx serve out
```

---

## License

The dashboard code and data-handling scripts are MIT licensed. The vote-data files are derived from public election returns (see source citations in the methodology page). The county and tract polygons are public-domain U.S. Census Bureau cartographic boundaries.
