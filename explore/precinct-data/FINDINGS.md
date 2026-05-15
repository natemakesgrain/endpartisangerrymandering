# Precinct data exploration

> **Phase 2 update — a working alternative "Precinct" dashboard view was
> built on this branch.** See [§8 Phase 2](#8-phase-2--the-precinct-view-built).
> A better data source than Phase 1's was found: **Dave's Redistricting
> `dra2020/vtd_data`** — 4 presidential cycles (2008/2012/2016/2020) on
> *consistent* 2020 VTD boundaries, all 50 states, self-contained GeoJSON
> with real returns + 2020 census pop + adjacency, public domain. Still
> branch-only, not pushed, not merged.

**Status:** exploration only — lives on branch `explore/precinct-data`, not
merged, not deployed. Question asked: *can precinct data make the modeling
more accurate, either by improving the census-tract partisanship model or by
using precincts outright instead of tracts/counties?*

Short answer: **yes, and the gain is large.** The current density-only tract
model is both *miscalibrated* and *weak in principle*; real precinct returns
replace a ~15-percentage-point guess with measured ground truth. Using
precincts as the ReCom substrate is technically a drop-in on the existing
per-state on-demand architecture. The only real blocker is **temporal
coverage**: nationwide precinct data exists for 2016/2018/2020 (2022/2024
still rolling out), while this project spans 2000–2024.

---

## 1. How partisanship works today

County-certified two-party results (`stiles_county.json`) are disaggregated
to census tracts by a **density-only logit model** in `buildTractUnits`:

```
pTract = sigmoid( logit(countyDShare) + 0.45 · log(tractDensity / countyMedianDensity) )
```

then rescaled so tract sums equal the county total. The `0.45` coefficient
is a plausible literature value, never validated against sub-county returns.
Precincts are the finest unit where votes are *actually counted*, so they let
us check that model directly.

## 2. Data sources evaluated

| Source | Coverage | Format | Usable here? |
|---|---|---|---|
| **MGGG `mggg-states`** (GitHub) | ~40 states, mostly 2016/2018 (some 2012–2020) | zipped shapefile + dual-graph JSON | **Yes** — direct raw download, permissive use, real raw counts. Used for this study. |
| **VEST** (Harvard Dataverse) | All 50 states, 2016/2018/2020 | zipped shapefile | Yes — open, gold standard; needs shapefile parsing. |
| **Redistricting Data Hub** | 50 states 2016–2020, 2022/2024 rolling out | shapefile / CSV | Yes but needs a free account + data agreement. |
| MGGG `*_dualgraph.json` | — | NetworkX JSON | **No** — vote/pop columns are normalized to ~1e-6; unusable for magnitudes. The *shapefile DBF* in the same repo is correct. |

Prototyped with **MI, PA, GA** (MGGG shapefiles, 2016 presidential) — three
deliberately different regions.

## 3. Result — is the density model accurate?

Test done at the precinct level (no CRS/intersection needed): within each
county, regress `logit(precinctD) − logit(countyD)` on
`log(density / countyMedianDensity)`. Script: `analyze.mjs`.

| State | Precincts | D-share check | Best-fit `W` | **R²** | RMSE: county-uniform → W=0.45 → calibrated |
|---|---|---|---|---|---|
| MI | 4,809 | 49.33% (real 49.88%) ✓ | **0.268** | **8.3%** | 16.66 → 16.24 → 15.13 pp |
| PA | 9,255 | 49.65% (real 49.62%) ✓ | **0.251** | **11.9%** | 15.18 → 14.69 → 13.33 pp |
| GA | 2,664 | 47.33% (real 47.34%) ✓ | **0.295** | **7.1%** | 17.82 → 16.93 → 16.64 pp |

Three independent conclusions, consistent across all three states:

1. **The precinct data is trustworthy** — each state's precinct-summed
   two-party share matches the real statewide result to ≤0.5 pp, and Σ
   population equals the exact census count.
2. **`W = 0.45` is too steep.** The empirically-correct coefficient is
   **0.25–0.30** (~0.27). The app overstates the urban→rural gradient by
   roughly 1.7×.
3. **Density alone is a weak signal — R² ≈ 7–12%.** ~90% of the
   within-county partisan variation is *not* explained by population
   density. Even a perfectly-calibrated density model cuts D-share error
   only ~1–2 pp below "just use the county average" (≈9–12% relative in
   MI/PA, ~7% in GA). The residual **~13–17 pp RMSE is the structural
   ceiling of any density-only model** — precisely what precinct data
   removes.

## 4. Result — precincts as a ReCom substrate (feasibility)

Script: `precinct_substrate_poc.mjs` (Michigan). Builds the exact unit
shape `runReCom` consumes — `{id, pop, votes:{d,r}, polygons}` — plus a
rook adjacency graph from shared polygon edges (same idea as the app's
shared-arc county adjacency).

```
precinct units            : 4,809   (vs ~2,772 census tracts, ~140 county fragments)
Σ population               : 9,883,640  (= 2010 census, exact)
Σ two-party votes          : D 49.33%  (REAL returns, not modeled)
adjacency edges            : 12,544   mean degree 5.2
connected components       : 8 (largest = 95% of units); 4 isolated units
graph payload (gzip)       : ~103 KB   (votes+pop+adjacency)
geometry topojson estimate : same order as the existing 928 KB MI tract file
```

Feasibility verdict: **drop-in on the existing per-state "upgrade"
architecture.** Same fetch-on-demand pattern as tracts today, ~1.7× the
units, similar shipped bytes. The graph is not fully connected (Great
Lakes islands/water gaps) — but that is the *same* problem the app already
solves for counties with the `WATER_GAP_BRIDGES` manual bridge list; it
just needs a precinct-level equivalent per state.

## 5. The real constraint: temporal coverage

- Nationwide precinct boundaries+results exist for **2016, 2018, 2020**
  (VEST/RDH, all 50 states). 2022 and 2024 are being released
  state-by-state and are not yet complete everywhere. Comprehensive
  pre-2016 national precinct data does **not** exist (some states only).
- This project spans **2000–2024** (7 presidential + 6 midterm cycles).
- Precinct boundaries are redrawn nearly every cycle and **do not nest in
  census geography**, so precinct results can't be cleanly reused across
  years the way the county pipeline is.

Implication: precinct data can *augment specific covered cycles* per state;
it cannot replace the county+model backbone for 2000–2012 (and, for now,
2022/2024). A hybrid is the only realistic architecture.

## 6. Recommendation (tiered, none merged yet)

1. **Free, do-now (model fix):** recalibrate `W_DENSITY` 0.45 → ~0.27 and
   update the methodology text. One-line change, strictly more accurate
   on the evidence here, zero new data or payload. *(Not yet applied —
   ideally validate `W` on ~2 more states / a second cycle first.)*
2. **Medium (precinct-validated tract model):** ship a small per-state
   precinct→tract D-share table for the covered cycles (2016/2018/2020)
   and use it instead of the density estimate when present, falling back
   to the (recalibrated) model elsewhere. Removes the ~15 pp guess for
   the years that matter most, modest payload.
3. **Large (precinct substrate):** add a precinct "upgrade" path mirroring
   the tract upgrade — real returns, finest districts — for covered
   state-cycles, plus a per-state water-gap bridge list. Best accuracy;
   most work; only the covered cycles.

Suggested if pursued: **#1 now, #2 as the real accuracy win** (keeps the
existing UX/architecture), revisit #3 only if precinct-level district maps
become a product goal.

## 7. Reproduce

```bash
# from a scratch dir (data is NOT committed — large shapefiles)
npm i shapefile@0.6.6
mkdir -p precinct && cd precinct
curl -sL -o MI.zip https://raw.githubusercontent.com/mggg-states/MI-shapefiles/main/MI.zip   && unzip -o MI.zip -d MI
curl -sL -o PA.zip https://raw.githubusercontent.com/mggg-states/PA-shapefiles/master/PA.zip && unzip -o PA.zip -d PA
curl -sL -o GA.zip https://raw.githubusercontent.com/mggg-states/GA-shapefiles/master/GA_precincts.zip && unzip -o GA.zip -d GA
cd .. && node analyze.mjs && node precinct_substrate_poc.mjs
```

Data © their providers (MGGG / VEST); used here for non-commercial research,
attribution due if any of this ships.

---

## 8. Phase 2 — the precinct view, built

Acting on the user's request ("build an alternative dashboard view that
uses full precinct level data … choose between county/tract or precinct …
as close to a real-world redistricted map as possible"). Branch-only.

### 8.1 Better data source (deeper dig)

Phase 1 used MGGG `mggg-states` (one cycle per state, shapefiles). The
deeper dig found a materially better source:

**`github.com/dra2020/vtd_data`** (Dave's Redistricting). Per state, ONE
self-contained GeoJSON whose features carry geometry + real returns
(`datasets.E_{08,12,16,20}_PRES.{Dem,Rep}`) + 2020 census population
(`datasets.T_20_CENS.Total`) + a rook adjacency graph — all on **consistent
2020 VTD boundaries**, all 50 states, **public domain**.

- Coverage: **PRES 2008 / 2012 / 2016 / 2020 universal** across the states
  checked (MI, PA, GA, TX, CA, FL, WI, NC, …); 2024 where DRA has loaded it.
  Downballot (SEN/GOV/AG) present for many states/cycles too.
- Solves Phase 1's killer caveat — consistent boundaries across cycles, so
  one geometry serves four presidential maps per state.
- Validation: pipeline-built 2020 two-party D-share matches reality within
  ~0.5 pt everywhere (CA 64.9% = exact, GA 50.1%, AZ 50.2%, OH 45.9%,
  PA 50.6%, MI 51.4%, …). Σ population = exact 2020 census.

### 8.2 Projection

App space is us-atlas `counties-albers-10m`. Verified empirically:
`d3.geoAlbersUsa().scale(1300).translate([487.5,305])` reproduces the
shipped MI tract topology bbox `[585.32, 83.2, 721.54, 227.55]` to within
~2 units (diff = tract-vs-VTD simplification). Precinct geometry overlays
the existing state outlines exactly.

### 8.3 What was built (all on branch)

- **`scripts/build-precincts.mjs`** — DRA GeoJSON → projected (app Albers),
  Douglas–Peucker-simplified, `/public/data/precincts/<fips>.json`
  (`{id, pop, v:{year:[d,r]}, polys}` + adjacency). Never drops a precinct
  with votes (a tiny-urban-precinct drop bias was caught and fixed — it had
  skewed CA 6 pts before the fix). `node scripts/build-precincts.mjs` (+ opt
  state list). Needs `d3-geo` (added to devDeps).
- **14 states built** (battlegrounds + 3 biggest): MI WI PA GA AZ NV NC NH
  MN VA OH FL TX CA. ~27 MB total (CA 6.7 MB worst case; most 0.5–3 MB).
  Any other state = run the script.
- **`Dashboard.jsx`**: `buildPrecinctUnits` (precinct file → the SAME unit
  contract as tracts, so every renderer works unchanged, but with REAL
  votes); `useStatePrecinctData` / `useStatePrecinctPartition` (fetch+build
  then ReCom, same stage protocol as the tract hooks); a **substrate
  toggle** in the headline (Model ⇄ Precinct); precinct **year restriction**
  (only 2008/12/16/20 selectable, others disabled & explained); a
  precinct-mode banner; precinct-aware detail copy; bolder district strokes
  + no precinct-mesh hairlines so the redistricting reads on the dense
  mosaic; uncovered-state fallback notice.

### 8.4 Verified end-to-end (browser)

- Model instant-render path **unchanged** (still 0 ms, 0 tract reqs).
- Toggle → banner + "PRECINCT CYCLES ONLY", year auto-snaps to 2020,
  non-precinct cycles disabled.
- Click Michigan → fetches **only** `26.json`, builds, ReCom on real
  precincts → **13 districts · 4,763 voting precincts · real 2020 returns ·
  max pop deviation 1.9% · D 6 · R 7** — the authentic real-data
  redistricting. Panel reads "voting precincts (2020 VTDs) … No
  county-level modeling".
- Toggle back to Model → fully reverts. No console errors.

### 8.5 Scope / honest limitations

- **State-detail is the real artifact.** A live national 50-state precinct
  ReCom (CA alone ≈ 25 k precincts) would hang the browser, so in precinct
  mode the *national overview* still shows the model districting and the
  real precinct redistricting is delivered per state on click. Making the
  national precinct map instant is the documented next step — and the app
  already has the exact pattern for it (the pre-rendered default-seed
  images); the precinct national maps for default seeds would be baked the
  same way.
- Precinct mode = the 4 covered presidential cycles, the 14 built states
  (others fall back to the model with a notice).
- CA file is 6.7 MB (on-demand, one state). Heavier simplification or
  topojson-arc encoding would shrink it if this ever graduated off-branch.
- Data © Dave's Redistricting (`dra2020/vtd_data`, public domain) +
  upstream VEST/Census; attribution due if shipped.
