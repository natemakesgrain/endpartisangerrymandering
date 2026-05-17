# End Partisan Gerrymandering Project — site

A static, deployable demonstration of algorithmic congressional redistricting.

Three pages, all client-rendered:

- `/` — interactive dashboard. Two neutral partitioners draw all 435 congressional districts across all 50 states from real geography: **shortest-splitline** (deterministic, no seed — the default) and **ReCom** (a seeded Markov chain, optional). Click any state to drop into a tract/precinct-level zoom.
- `/methodology` — technical overview, citations, data sources, honest-limitations section.
- `/legislation` — proposed federal statute + constitutional amendment.

**Two algorithms.** Shortest-splitline (Warren D. Smith) is the default: a recursive shortest-line population-quantile bisection plus a deterministic contiguity-preserving rebalance — no seed, fully reproducible from geography alone. ReCom (DeFord–Duchin–Solomon 2021) is the optional seeded sampler; reseed for a different valid neutral map. The methodology page (§4.8/§4.9) compares them honestly.

**Two substrates.** *Model* — counties → 2020 census tracts, with within-county partisanship modeled by population density; covers all **13 cycles** (7 presidential with real MIT-EDSL county returns: 2000/04/08/12/16/20/24, plus 6 *modeled* midterms: 2002/06/10/14/18/22, labeled "MODELED"). *Precinct* — real 2020-VTD returns from Dave's Redistricting `vtd_data`, no modeling, for the four precinct cycles (2008/2012/2016/2020).

**Apportionment is per-decade — everywhere.** A state is split into the number of districts its *governing census* assigned for that cycle (1990→2000 elections, 2000→2002-2010, 2010→2012-2020, 2020→2022-2024) in **both** the state-detail view **and** the 50-state national overview, under both models and both substrates (e.g. Montana = 1 district in 2020, 2 in 2022). So switching years is *not* a pure recolor — the national engine recomputes when you cross a decade boundary; within a decade it just recolors by that year's votes. See methodology §2.

Population deviation is shown in the UI in real time:

- **Shortest-splitline (default):** the quantile cut + deterministic bidirectional rebalance reaches ≈1–2 % worst-district even on the hardest states (measured: TX 1.8 %, CA 1.3 %, NC 0.8 %). It is a bounded greedy pass, not a hard ±ε proof — the state-detail header always reports that map's *real* worst-district deviation.
- **ReCom:** the ±5 % bound is *enforced* by a polish loop + multi-seed retry; the auto-upgrade-to-tract pipeline delivers 44/44 multi-seat states inside ±5 % (typically 1–3 %).

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

This reads `data-cache/stiles_county.json` (downloaded once on first run, then cached) and writes `public/data/votes/<YEAR>.json` for each presidential year. The 2016/2020/2024 files are preserved as-is — sourced separately and verified to match published official totals. Modeled midterms: `node scripts/build-midterm-votes.mjs`.

Precinct substrate data is built separately from Dave's Redistricting `vtd_data`:

```bash
node scripts/build-precincts.mjs        # download + simplify + ReCom-bake + dissolve
node scripts/add-demographics.mjs       # merge 2020 P.L. race/VAP (fast attribute merge)
node scripts/add-splitline-national.mjs # merge deterministic Splitline dissolve (no re-download)
```

`scripts/lib/{recom,partition}.mjs` are **auto-extracted** from `components/Dashboard.jsx` by `_extract_recom.mjs` / `_extract_partition.mjs` so the offline bake runs the *exact* in-app algorithm — re-run the extractors after editing those blocks.

---

## What this dashboard does NOT cover

**Midterm cycles are MODELED, not measured.** The six midterm cycles (2002/06/10/14/18/22) *are* in the dashboard but are modeled: U.S. House results are reported by district (not county), so there is no unified national county-level House dataset. Each state's real two-party U.S. House aggregate (MIT EDSL) is applied as a per-state logit swing to the nearest presidential year's county pattern, rescaled to match the state House total. Midterm rows are labeled **"MODELED"** in the headline so the substrate is never ambiguous. The seven presidential cycles use real county-level returns.

**Tract-level partisanship (model substrate) is modeled.** No federal authority publishes precinct→tract election crosswalks, so county votes are disaggregated to tracts by a population-density logit model, rescaled per-county-per-year to the official county totals exactly (methodology §3.4). The **precinct substrate** avoids this entirely — it is real counted 2020-VTD returns. Also: the bundled tract geometry is mapshaper-simplified, so tract populations are renormalized per county to the authoritative 2020 P1 county totals.

**The national overview is a coarser *granularity* than the state detail, by design.** It uses county-fragment→tract units (model substrate) or pre-dissolved district polygons (precinct substrate); the tract/precinct-exact districting is the state-detail view. District *counts* now match per-decade across both views.

**Two neutral algorithms; the default is deterministic.** Shortest-splitline (the default) needs *no seed* — the same geography always yields the same map. ReCom is the optional seeded sampler (default seed = 42, reseedable); different seeds produce different valid neutral maps. There is no single "fair" map — there is a *distribution* of valid maps (ReCom samples it) or a single canonical deterministic one (splitline). Neither consumes partisan or incumbency data.

---

## Repo layout

```
site/
├── app/                      # Next.js routes
│   ├── page.tsx              # / (dashboard)
│   ├── methodology/page.tsx  # /methodology
│   └── legislation/page.tsx  # /legislation
├── components/
│   ├── Dashboard.jsx         # the big one — splitline/ReCom partitioners + map renderer
│   ├── Nav.tsx
│   ├── Footer.tsx
│   └── Prose.tsx
├── content/
│   ├── methodology.md        # kept in sync with the implementation (the project's ethos)
│   └── legislation.md
├── public/
│   └── data/
│       ├── populations.json     # 2020 Decennial P1 county pops (3,143 counties)
│       ├── votes/
│       │   ├── 2000.json … 2024.json   # county D/R/total, 13 cycles
│       │   │                           # (7 presidential real, 6 midterm modeled)
│       ├── tracts/
│       │   └── 01.json … (51 files, ~29 MB) per-state 2020 tract topojson + P1 pops
│       └── precincts/
│           ├── 48.json          # full per-state DRA 2020-VTD returns + adjacency + dm
│           └── 48-districts.json# tiny: dissolved district polys per ReCom seed
│                                # AND a deterministic `splitline` block
├── scripts/
│   ├── build-historical-votes.mjs   # presidential county votes
│   ├── build-midterm-votes.mjs      # modeled midterm county votes
│   ├── build-precincts.mjs          # DRA vtd_data → precinct json + ReCom bake/dissolve
│   ├── add-demographics.mjs         # merge 2020 P.L. race/VAP into precinct json
│   ├── add-splitline-national.mjs   # merge deterministic Splitline dissolve into -districts.json
│   ├── _extract_recom.mjs           # extract ReCom block → lib/recom.mjs (keep in sync)
│   ├── _extract_partition.mjs       # extract partitioner block → lib/partition.mjs
│   └── lib/{recom,partition}.mjs    # the extracted pure modules the pipeline imports
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
