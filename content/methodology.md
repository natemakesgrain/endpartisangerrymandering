# Algorithmic Congressional Redistricting: Technical Overview

This document explains how the dashboard generates congressional district maps for all 50 states, end-to-end. It covers the data sources, the algorithm, the geometric rendering, and the trade-offs at each stage.

---

## 0. Executive summary

**What this dashboard delivers.** For every U.S. presidential and midterm election cycle from 2000 through 2024, the dashboard produces a neutrally-drawn 435-seat congressional map for all 50 states, with the following verified properties:

- **44 of 44 multi-seat states** land inside the ±5 % population-deviation bound courts apply to congressional districts (worst-case state typically 1–3 %, far inside the legal limit) — *under the ReCom pipeline*, where ±5 % is actively enforced by a polish loop and multi-seed retry. The default shortest-splitline method targets equal population but does not enforce it (no polish/retry); it can leave individual under-populated districts, and the state-detail header always reports that map's real worst-district deviation rather than a claimed bound. See §4.8–4.9.
- **Districts are visibly compact.** Under the shortest-splitline default, compactness *is* the objective function — every cut is the shortest available straight line. Under ReCom, a graph-isoperimetric gate on every accepted spanning-tree cut rejects pathologically elongated pieces, and among multi-seed retries that meet ±5 % the partition with the lowest mean cross-edge count per district is selected, optimizing explicitly for shape.
- **Every map is bit-for-bit reproducible.** The default shortest-splitline map needs no seed at all — the geography and the open-source reference code fully determine it. ReCom maps are reproducible from a public seed: anyone with the seed, the census-tract geography, and the reference code regenerates the same map, and no party can game a ReCom result without changing the seed protocol itself, which is designed (legislation Part I, Sec. 4(b)(2)) to make pre-commitment infeasible.
- **No partisan or incumbency data is consumed** at any step. The algorithm sees only census-block / tract geography, population, and adjacency.
- **~100–130 competitive districts per cycle** (|margin| ≤ 10 percentage points) under neutral procedure, versus 37 (2024) and 71 (2022) under the actually-enacted post-2020 House maps. Across all 13 cycles in the dashboard, real maps produced 23–89 competitive seats; the algorithm produces ~100–130 every time. The contrast is what the dashboard exists to display.

**What the algorithm does not decide.** The Markov chain decides nothing about who wins; it decides only the shape of the contest. Specifically, it does not optimize for proportional representation (see §6.6 below on why), does not preserve "communities of interest" (a known cost, see §6.7), and does not condition on race (a design choice; see Drafter's Note in the legislation). The legislation Part I treats those decisions as political, not algorithmic — the Independent Districting Standards Board is the political body that decides which neutral algorithm to use, and the seed protocol is the political process that decides which valid map within that algorithm's distribution is drawn each cycle.

---

## 1. The problem

The U.S. Constitution requires the 435 House seats to be apportioned among the states by population, and within each state, to be drawn into geographically contiguous districts of roughly equal population (Wesberry v. Sanders, 376 U.S. 1, 1964). In practice, state legislatures (or independent commissions in 8 states) draw these maps every 10 years following the decennial census. The drawing process is widely understood to be vulnerable to gerrymandering — the deliberate construction of district shapes to advantage one party — which has been the subject of extensive legal challenges (Rucho v. Common Cause, 588 U.S. 684, 2019).

The structural costs of gerrymandering are well-documented: (a) suppression of competitive races (the U.S. House had only 37 districts decided within a 10-point margin in 2024, against ~130 in neutrally-drawn algorithmic ensembles on the same partisan geography); (b) distortion of statewide outcomes (the party with the brush draws an in-built seat advantage that can flip control of Congress on identical popular votes); and (c) the resulting erosion of representative accountability — members elected from safe districts have no electoral incentive to attend to the median voter in their district, because the median voter cannot defeat them.

This dashboard generates maps **algorithmically**, with no input from political considerations. The default method — shortest-splitline (§4.8) — is fully deterministic: the same code produces the same single map for a state every time, with **no seed at all**. The alternative method — ReCom (§4.1–4.7) — is a sampler: the same code given the same random seed produces the same map, while different seeds produce different valid maps drawn from the space of all balanced contiguous partitions. Either way the intent is identical: show what neutrally-drawn maps look like, as a baseline for evaluating real maps.

---

## 2. Data sources

**Geography.** County polygons come from the U.S. Census Bureau's 2020 cartographic boundary shapefiles (`cb_2020_us_county_500k`), simplified and pre-projected to Albers USA pixel space via the `us-atlas` library (Bostock 2010-present). Tract-level data (used in the state-detail view when configured) comes from the corresponding tract-level shapefiles (`cb_2020_<FIPS>_tract_500k`), processed identically.

**Population.** 2020 Decennial Census P1 table totals, fetched per-county and per-tract from the Census Bureau's API (`api.census.gov/data/2020/dec/pl`). The *same* 2020 population is used to balance districts in every cycle, including pre-2020 ones — building a true per-decade per-unit population series would require reconciling three different county/tract geographies (counties merge and split, tracts are fully redrawn each census) and the 1990/2000/2010 P.L. files, a separate pipeline not embedded here. Using 2020 population as a cross-decade balancing proxy is a disclosed modeling approximation in the same class as the modeled midterms and the density-disaggregated tract partisanship; it shifts where a balanced cut lands slightly but does not change the *number* of districts, which is set exactly per decade by apportionment (next paragraph).

**Election results.** Two-party returns for **13 cycles — seven presidential (2000, 2004, 2008, 2012, 2016, 2020, 2024) and six midterm (2002, 2006, 2010, 2014, 2018, 2022)**.

*Presidential cycles* use official county-level returns from the MIT Election Data and Science Lab, accessed via the [stiles/presidential-elections](https://github.com/stiles/presidential-elections) processed JSON for 2000–2012 and via [tonmcg/US_County_Level_Election_Results_08-24](https://github.com/tonmcg/US_County_Level_Election_Results_08-24) for 2016/2020/2024. National 2-party D-share for each year matches the FEC-certified popular vote total to within 0.1 percentage points.

*Midterm cycles* are **modeled** — county-level U.S. House results don't exist as a unified dataset because counties can be split across multiple congressional districts. Instead we take each state's real two-party U.S. House aggregate D-share (from the MIT EDSL 1976–2022 House dataset) and apply a per-state logit-space swing to the nearest presidential year's real county pattern, rescaling so the state's modeled total matches the actual state House vote exactly. This captures the real per-state midterm swing geographically (e.g. 2018's massive D shift in California vs the much smaller shift in Tennessee both fall out of state-level swings, not a uniform national correction) while holding within-state county rankings constant at the base presidential year. The recovered national 2-party share for each modeled cycle lands within 0.2 percentage points of the FEC-reported House popular vote. See [scripts/build-midterm-votes.mjs](https://github.com/natemakesgrain/endpartisangerrymandering/blob/main/scripts/build-midterm-votes.mjs) for the implementation. Midterm years are labeled "MODELED" in the dashboard headline so the reader knows which substrate they're looking at.

**Tract-level partisanship is also modeled, not measured** — no federal authority publishes precinct-to-tract election crosswalks. Rather than disaggregating county votes uniformly (every tract gets the parent county's per-capita D-share, erasing all within-county variation), we apply a **population-density partisanship model**: each tract is shifted in logit space by `0.45 × log(tract_density / county_median_density)`, then per-county per-year rescaled so the county's tract-D-vote sum exactly matches the official county D-vote total (and same for R). See §3.4 for the full derivation. The 0.45 coefficient is in the lower end of national multilevel-model estimates of the log-density-to-logit-D slope from Rodden, Chen, and the post-2016 partisan-geography literature.

**Apportionment (per decade).** The 435 House seats are reapportioned among the 50 states after every decennial census, and a new apportionment governs elections **two years** after its census. The dashboard embeds the full per-decade seat table from the Census Bureau's *Table C1, "Number of Seats in U.S. House of Representatives by State: 1910 to 2020."* Election year → governing census:

| Election cycles | Governing census | Example: Texas seats |
|---|---|---|
| 2000 | 1990 | 30 |
| 2002, 2004, 2006, 2008, 2010 | 2000 | 32 |
| 2012, 2014, 2016, 2018, 2020 | 2010 | 36 |
| 2022, 2024 | 2020 | 38 |

So viewing 2004 splits each state into its **2000-census** district count (Texas 32, New York 29, Ohio 18, Florida 25), and viewing 2022 uses the 2020-census count (Texas 38, New York 26, Ohio 15, Florida 28). This per-decade apportionment is applied **exactly** in the enlarged state-detail view — the surface that actually draws a state's districts — under both partitioners. **Scope note:** the national 50-state overview (and the committed seed mosaics / pre-baked precinct-national tiles) renders at 2020 apportionment regardless of the cycle selected; it is a fixed-geometry overview recolored by each year's votes, and re-running three separate national passes per decade is deferred. The historically-correct district count for any cycle is always available by clicking into the state.

---

## 3. Substrate: counties, fragments, tracts

The algorithm partitions the state into districts by assigning **units** to districts, where each unit is an indivisible building block. Three substrates exist in the codebase, but in practice the dashboard is **tract-substrate-by-default** for every multi-seat state:

1. The national pass begins with county-fragment substrate (§§3.1–3.2) for a fast first render.
2. Every multi-seat state is then **automatically upgraded** to tract substrate (§3.3) — for both the algorithm and the rendering — so the national view and the state-detail view show the same partition with the same boundaries. The county-fragment substrate is therefore a transient intermediate state, not the deployed substrate.
3. Single-seat states (AK, DE, ND, SD, VT, WY) skip the upgrade because there's no partitioning to do: every census block in the state is in the single at-large district.

The three substrates:

### 3.1 County-level (default)

3,143 U.S. counties (and county-equivalents like Louisiana parishes, Alaska boroughs) form the natural unit set. ReCom (the partition algorithm — see §4) assigns each county to a district such that contiguous groups of counties form equal-population districts.

**Problem.** A target district is roughly state-population / state-seats people (e.g., NC: 10.4M/14 ≈ 740K). Several U.S. counties are larger than this: Los Angeles County has ~10M people (13× the target), Cook County (Chicago) has ~5M, Maricopa (Phoenix) has ~4.4M. ReCom can't balance districts at county granularity if any single county is bigger than the target.

### 3.2 County fragments (slab-cut counties)

When a county exceeds the state's target district population, we **slab-subdivide** it into N approximately equal-population fragments via recursive bisection along the longest axis:

```
slabSubdivide(polys, N):
  if N <= 1: return [polys]
  axis = longest dimension of bbox
  for i in 1..N-1:
    binary-search for split position along axis
    such that area below split ≈ totalArea / N
  return N fragments
```

This produces N fragments that look like horizontal or vertical strips cutting through the county. Each fragment inherits a per-capita share of the parent county's population and votes. Fragments are bridged in the adjacency graph by both shared geometric edges (between consecutive slabs) and the centroid-nearest-fragment matcher (which connects fragments to neighboring counties). This is enough for ReCom to operate.

**Tradeoff.** Slab cuts are arbitrary — population balance demands they exist, but their exact placement is a function of the algorithm, not real geography. When two adjacent fragments end up in different districts, the "boundary between them" is not a meaningful district line — it's an artifact. The dashboard renders these slab-cut boundaries as dashed light strokes (rather than solid black) to signal their approximate nature, while real geographic boundaries (county lines, state lines) get solid strokes.

### 3.3 Census tracts (national auto-upgrade + state-detail view)

Tracts are the canonical fine-grained Census Bureau unit: ~84,000 nationwide, ~2,000-9,000 per state, average ~3,500 people each. At tract granularity, no tract is larger than the target district population, so no subdivision is needed. Ramifications:

- **Population balance**: easily achievable to within ±1% (vs ±5% at county granularity)
- **Geographic boundaries**: organic, following real census-tract lines (which themselves follow streets, rivers, neighborhoods)
- **No slab artifacts**: the artificial cuts that show up in metropolitan counties at county granularity are absent
- **Cost**: ~28 MB of geometry must be served (51 per-state files), bundled with the static build

The algorithm itself is identical across substrates.

**Automatic upgrade for failing states.** After the county-level pass completes, every state whose `maxDev > tolerance` (i.e. still over ±5%) is *automatically* upgraded to tract-level partitioning, sorted worst-first. For each such state we (a) lazy-fetch its tract topojson, (b) build tract units and adjacency (Wilson's algorithm + the same shared-arc adjacency derivation used at county level), (c) run ReCom on the tract graph with a tighter tolerance (`min(target_tolerance, 2%)`) and longer burn-in (`max(400, seats × 22)`), (d) project the tract assignment back to county fragments by bbox containment (with nearest-centroid fallback), and (e) replace the failing partition with the upgraded one. The variance metric and per-state population balance reported in the headline reflect the underlying **tract-level** deviation — the projection back to fragments is rendering only. This delivers 44/44 multi-seat states inside ±5 % on default settings.

### 3.4 Within-county partisanship: density-weighted disaggregation

No federal authority publishes precinct-to-tract election crosswalks, so tract-level vote totals don't exist as direct measurements. Earlier versions of this dashboard disaggregated county votes uniformly across tracts (every tract within a county got the same per-capita D-share), erasing all within-county geographic variation in partisanship.

We now apply a **population-density partisanship model**:

```
for each tract t in county C:
  density_t  = tract_pop_t / tract_area_t                        (people per pixel² in Albers USA)
  rel_t      = log(density_t / median_density_within_C)
  dLean_t    = 0.45 × rel_t                                      (logit-space shift)

for each year:
  p_t        = sigmoid(logit(C.dshare_year) + dLean_t)            (predicted tract D-share)
  raw_d_t    = (tract_pop_t / county_pop_C) × C.total_votes_year × p_t
  raw_r_t    = (tract_pop_t / county_pop_C) × C.total_votes_year × (1 - p_t)

  # rescale per county per year so totals match the official county returns exactly
  scale_d    = C.d_year / Σ_t raw_d_t      
  scale_r    = C.r_year / Σ_t raw_r_t
  tract.d_year = round(raw_d_t × scale_d)
  tract.r_year = round(raw_r_t × scale_r)
```

The 0.45 coefficient is the discrete-tract analog of the log-density-to-logit-D slope in published national multilevel models (Rodden, Chen, and others place it in the 0.3–0.7 range; we picked a middle value). The rescaling is the critical step: it preserves the *county-level truth* of the official returns exactly while adding within-county variation along the urban-rural axis.

**Limitations.** Density is the strongest non-racial predictor of partisanship, but race and education matter too — Black-majority urban tracts vote more D than non-Black urban tracts of equal density, and college-educated suburbs have shifted sharply D since 2016. A more complete model would incorporate ACS tables B02001 (race), B03002 (Hispanic origin), and B15003 (educational attainment for 25+). The build pipeline for that is straightforward (fetch via Census API given a key, embed per-tract `dLean` factors into the tract topojson) but lives outside this iteration.

---

## 4. The partitioning algorithms

The dashboard ships **two** neutral partitioners, selectable in the model picker. Both consume only geography, population, and adjacency — no partisan or incumbency data:

- **Shortest-splitline (the default).** A fully deterministic recursive bisection that cuts the state into equal-population halves with the geometrically shortest available straight line, recursing until each piece holds one seat. A state and its seat count determine exactly one map — no random seed. Specified in §4.8.
- **ReCom (Recombination).** A Markov-chain sampler over the space of balanced contiguous partitions; the same seed reproduces a map, different seeds produce different valid maps. Built up in §4.1–4.7.

§4.9 compares the two head-to-head. ReCom is presented first only because it is the more intricate method and §4.1–4.7 develop it in detail; the shortest-splitline *default* is specified in §4.8 and presupposes nothing from the ReCom subsections.

ReCom (short for **Re**combination) is a Markov chain Monte Carlo method for sampling from the space of valid balanced contiguous partitions of a graph. It was introduced in DeFord, Duchin, and Solomon (2021), "Recombination: A family of Markov chains for redistricting," *Harvard Data Science Review* 3(1) [<https://hdsr.mitpress.mit.edu/pub/1ds8ptxu>]. ReCom is widely used in academic and litigation-related redistricting analysis: it appears in Mattingly's North Carolina ensemble work (Bangia, Graves, Herschlag, Kang, Luo, Mattingly, Ravier 2017; *cf.* Common Cause v. Rucho, 318 F. Supp. 3d 777, M.D.N.C. 2018) and in MGGG's expert reports across multiple state redistricting cases.

The implementation here closely follows the standard formulation:

### 4.1 Setup

Given:
- A set of $N$ units, each with population $p_i$
- An adjacency graph $G = (V, E)$ where $V$ are units and $E$ connects geographically-adjacent units
- A number of districts $k$ (= state's apportioned seats)
- A balance tolerance $\epsilon$ (e.g., 0.05 = ±5%)

Goal: a partition of $V$ into $k$ disjoint subsets $D_1, \dots, D_k$ such that:
1. Each $D_i$ induces a connected subgraph of $G$ (contiguity)
2. Each $D_i$'s total population is within $(1 \pm \epsilon)$ of $\bar{p} = \sum p_i / k$ (balance)

### 4.2 Initial partition: recursive bisection

We start with a single trivial partition (everything in district 1) and recursively split it:

```
recomInitialPartition(units, adjacency, k, rng):
  districts = [{ all units }]
  while len(districts) < k:
    pick a district to split (largest-population first)
    bisect it into two via balanced spanning-tree cut (see §4.3)
  return districts
```

Bisection uses a single ReCom step constrained to produce a 2-way split.

### 4.3 The recombination step (ReCom)

The core operation: given two adjacent districts $D_i$ and $D_j$, merge them, sample a uniform spanning tree of the merged region, find a balanced edge to cut, and reassign units to either side of the cut. Pseudocode:

```
recomStep(state, rng, opts):
  pick adjacent district pair (D_i, D_j)
    — biased toward pairs whose pop sum gives more cut options
  T = uniformSpanningTree(D_i ∪ D_j, adjacency, rng)
  # T is a spanning tree of |D_i ∪ D_j| nodes, |D_i ∪ D_j| - 1 edges
  cut_edge = find a tree edge whose removal gives two components with
             populations within ±epsilon of target
  if no such cut_edge exists: REJECT (try again)
  D_i' = one component, D_j' = other component
  ACCEPT: replace (D_i, D_j) with (D_i', D_j')
```

#### 4.3.1 Uniform spanning tree (Wilson's algorithm)

We sample a uniformly-random spanning tree via Wilson's algorithm (Wilson 1996, "Generating random spanning trees more quickly than the cover time"; *cf.* Propp & Wilson 1998), which uses loop-erased random walks. Critically, the resulting tree is a uniform random sample over all spanning trees — required for the underlying Markov chain to be well-defined. The standard spanning-tree-via-DFS approach would NOT preserve the uniform distribution and could systematically bias the resulting maps.

```
uniformSpanningTree(nodes, adjacency, rng):
  root = nodes[0]
  parent = {root: -1}
  for each node v not yet in tree:
    walk randomly from v until hitting the tree
    erase loops in the walk path
    set parent[walk path nodes] = next-node-in-walk
  return parent
```

#### 4.3.2 Balanced tree cut via dynamic programming

Given the spanning tree, we find a balanced edge cut in O(N) time via subtree-population DP:

```
treeBalancedCut(tree, populations, target, tolerance):
  for each node u in post-order:
    subtreePop[u] = pop[u] + sum(subtreePop[c] for c in children[u])
  for each non-root node u:
    leftSide = subtreePop[u]
    rightSide = totalPop - leftSide
    if both within (1 ± tolerance) * target: emit cut at edge u→parent[u]
  return all valid cuts
```

If multiple cuts exist, we pick one at random. If none exist, the step is rejected and we re-sample a new spanning tree.

### 4.4 Markov chain mixing

We run the ReCom chain for a **dynamic** burn-in period — long enough for the chain to find a balanced partition, short enough to keep first-load latency under ~30 seconds for 50 states. Default schedule:

| substrate | base burn-in | per-retry extension |
|---|---|---|
| county fragments | `max(120, min(400, seats × 14))` | +60 steps per retry attempt |
| tract upgrade | `max(400, seats × 22)` | (single pass, no retry escalation) |

The burn-in uses graduated tolerance: it starts at 10× the target tolerance (so the chain can move freely at first) and tightens geometrically toward the target tolerance over four sub-phases. Each accepted step is a Markov-chain transition; each rejected step is a no-op (the chain stays put).

The chain has polynomial mixing time on planar graphs (Najt, Solomon, Wachs 2019, arXiv:1908.08881) but the constants can be large. In practice, the schedule above produces a partition close enough to the stationary distribution for visualization purposes. The published academic standard for litigation-grade analysis is typically 10,000–100,000 ReCom steps producing a large ensemble; that's not what we're doing here. We produce ONE map per seed, treating the chain output as a neutral sample, not characterizing the full distribution.

**Multi-seed retry with partition-level selection.** Each state runs up to ten independent retries from distinct derived seeds. Across those retries we apply a two-tier selection rule:

1. Among retries that **meet ±tolerance**, we keep the partition with the lowest mean cross-edge count per district (the compactness tie-breaker — see §4.6).
2. If no retry met tolerance, we keep the lowest-max-deviation partition.

This makes the ±5 % balance constraint a *hard guarantee* in practice (the algorithm has ten independent attempts to find a balanced partition) and the compactness optimization an *explicit* selection criterion rather than an emergent property of the chain.

### 4.5 Polish phase

After burn-in, the Markov chain may have produced a partition that's contiguous but only weakly balanced (some districts well over target, others well under). To tighten balance, we run a deterministic polish phase:

```
polish:
  while max-deviation > target tolerance:
    pick the most-deviated district D_max
    find a single boundary unit move that:
      - reduces max-deviation
      - preserves contiguity of source district
      - the boundary unit comes FROM a less-deviated neighbor
    apply the move
    if no improving move exists for any district: bail (local minimum)
```

This is hill-climbing on max-deviation, not part of the ReCom chain proper. It produces a partition that's both contiguous (by the move's contiguity check) and tightly balanced (by the loop's convergence criterion).

**Implementation detail.** The contiguity check on a candidate move is the most expensive operation (a BFS over the source district). To amortize, we maintain a Uint8Array of "boundary units" — units adjacent to a different district — and only scan these during each polish iteration. This reduces per-iteration cost from O(N × deg) to O(boundary × deg), typically 10-50× speedup at tract granularity.

**Perturb-and-repolish loop.** Polish can get stuck in local minima where no single-unit move improves max-deviation but some districts are still above tolerance. To escape, we wrap polish in an outer loop that, on each stall, runs ~4k extra ReCom steps under a loosened tolerance (2 × target or 10 %, whichever is larger), then re-polishes. Up to 3 such cycles are attempted. The lowest-max-deviation partition seen across cycles is retained as the run's output. Empirically this rescues partitions in states with a single dominant metropolitan county whose first-polish minimum is geometrically near-optimal but still above the ±5 % bound.

### 4.6 Compactness gate

ReCom produces reasonably compact districts as a side effect of the spanning-tree cut step, but occasionally a balanced cut produces a piece that's geometrically thin — a coastal sliver, a snaking string of tracts. To bias the chain toward visually reasonable shapes without disrupting the underlying Markov-chain semantics, we add a **graph isoperimetric filter** on each accepted cut:

```
For each candidate cut produced by findBalancedCuts:
  cross_edges = adjacency edges that cross the cut
  small = min(piece_a.size, piece_b.size)
  iso_ratio = cross_edges / small
Filter to cuts with iso_ratio ≤ THRESHOLD.
If no cut survives, double THRESHOLD and retry — guarantees ergodicity:
  every balanced cut is reachable, just with biased probability.
Select uniformly among surviving cuts.
```

A compact piece in a planar graph has `iso_ratio ~ O(1/√N)`; an elongated strip has `iso_ratio ~ O(1)`. The threshold rejects pathologically elongated pieces while leaving normal cuts untouched. This is the discrete analog of the Polsby–Popper score (`4πA / P²`) appropriate to graph partitioning, and matches the "edge isoperimetric" appendix of DeFord–Duchin–Solomon (2021) in spirit.

**Retry-schedule compactness ladder.** Each state runs up to ten independent retries. The compactness threshold tightens progressively:

| attempt | threshold | intent |
|--:|--:|---|
| 0–1 | **0.8** | strict — favors near-circular pieces, the visual default |
| 2–3 | 1.2 | moderate — accepts most reasonable cuts |
| 4–6 | 2.0 | loose — last gasp at balance under any geometry |
| 7+ | ∞ | no compactness filter, balance only |

Because the chain meets the population-balance constraint within the first 2–3 attempts for virtually every state, the strict 0.8 threshold is what produces the visible map in practice; later, looser attempts only kick in for pathologically-shaped states where the strict version can't land ±5 %.

**Partition-level selection.** Across the up-to-ten retries, we don't just pick the lowest-maxDev partition — we pick the partition with the **lowest mean cross-edge count per district** *among those that hit ±5 %*. This explicitly optimizes for visual compactness across retries: when two partitions both meet the population constraint, the one whose districts have fewer "boundary edges" per district (i.e., more compact, less spaghetti) wins.

### 4.7 Convergence and seed sensitivity

Different random seeds produce different valid partitions. They share the high-level structure (which counties belong to which "natural" district cluster) but differ in fine-grained boundary placement. This is an honest reflection of the algorithm's character: there is no single "correct" neutral map — there is a *distribution* of valid maps, and any neutrally-drawn map should be regarded as a sample from that distribution.

For litigation contexts, the standard practice is to run a **large ensemble** (10K-100K ReCom maps) and use the ensemble's properties as a baseline against which proposed maps are compared. See Chen and Rodden (2013), "Unintentional gerrymandering: Political geography and electoral bias in legislatures," *QJPS* 8(3); Herschlag, Ravier, and Mattingly (2017), arXiv:1709.01596; and Cain et al. (2018), "A reasonable bias method for redistricting," arXiv:1804.07003 for typical ensemble methodology.

This dashboard runs ONE map per seed for visualization purposes. Reseed to see how the result varies.

### 4.8 The shortest-splitline algorithm (the default)

Shortest-splitline is a fully deterministic recursive-bisection method, due to Warren D. Smith (rangevoting.org, "Gerrymandering and a cure: the shortest-splitline algorithm," 2007). It is the dashboard's **default** partitioner. There is no random seed and no Markov chain: a state and its seat count determine exactly one map.

```
splitline(members, K, firstDistrictId):
  if K == 1:
    assign every unit in `members` to firstDistrictId; return
  A = floor(K / 2);  B = K - A
  targetA = (total population of members) × A / K
  hull = convex hull of member centroids
  best = none
  for theta in 120 evenly-spaced orientations over [0, pi):
    n = (cos theta, sin theta)
    sort members by projection  n · centroid
    walk the sorted list, accumulating population, until it reaches targetA
    place the cut line at the midpoint between the two straddling projections
    L = length of the chord this line cuts across `hull`
    keep (theta, cut) if L is the shortest seen
      tie-break: prefer the most north–south line, then the westernmost cut
  aSide = members below the chosen cut   → gets A seats
  bSide = members above the chosen cut   → gets B seats
  splitline(aSide, A, firstDistrictId)
  splitline(bSide, B, firstDistrictId + A)
```

Properties:

- **Population balance is targeted, not guaranteed.** Each cut is *placed* at the population A/K quantile of the members along the chosen axis, so in the idealised continuous case the two halves are exactly balanced. On real non-convex tract/precinct graphs that ideal is only approached: the split is decided on one-dimensional centroid projections (a tract whose centroid lands on the far side of the line still goes there in full), a degenerate convex hull falls back to an even *index* split, and — by design — there is **no polish phase, no retries, no multi-seed selection** to repair what the single deterministic pass produced. In practice most districts land within a few percent of target, but a given map can contain one or more markedly under-populated districts, and shortest-splitline will not fix them. This is the direct price of determinism: ReCom's soft ±5 % is *enforced* by a polish loop and multi-seed retry; shortest-splitline's balance is whatever the one pass yields. (The dashboard's state-detail header reports the actual worst-district deviation so the reader always sees the real number, not a claimed one.)
- **Compactness is the objective, not a by-product.** Each cut is the *shortest straight line* that splits the piece in the required population ratio, minimised over 120 orientations against the convex hull. The optimisation target is literally boundary length — the continuous-geometry compactness notion that ReCom only approximates with a graph proxy (§4.6).
- **Deterministic and unique.** No RNG, no seed, no burn-in, no retry ladder — the recursion is a pure function of geography and seat count. This is exactly why the dashboard hides the Reseed control when shortest-splitline is selected: there is nothing to reseed.
- **Contiguity is _not_ guaranteed.** A straight cut through a non-convex or archipelagic state can leave a district in disconnected pieces. A deterministic post-pass (`enforceContiguity`) reassigns only *small* stray components — specks below ≈0.06 % of the unit count — to the adjacent district they border most; large, legitimately-disconnected pieces are deliberately left intact rather than distorting the quantile cut to glue them. ReCom, by contrast, guarantees contiguity by construction (it cuts a spanning tree of the *adjacency* graph). This is the principal honest cost of running shortest-splitline as the default.
- **The cut is geography-blind.** It is a literal straight line on projected unit centroids. It does not bend around a river, a county line, or a metropolitan boundary; a city is sliced cleanly in two if the population quantile falls there. This is a sharper form of the community-of-interest cost in §6.7 — shortest-splitline has *zero* slack to keep a community whole, whereas a ReCom spanning-tree cut at least follows real adjacency edges.

The 120-orientation sweep and the convex-hull chord length are discretisation choices; finer angle steps shift individual boundaries marginally but not the high-level structure.

### 4.9 ReCom vs. shortest-splitline: advantages and disadvantages

Both methods are neutral (no partisan input) and both are shipped in the dashboard; the model picker switches between them. They encode different definitions of "fair," and the trade-offs are explicit:

| Dimension | Shortest-splitline (default) | ReCom |
|---|---|---|
| Determinism | One state → exactly one map. No seed. | Stochastic; one map *per seed*. |
| Reproducibility / gaming-resistance | Maximal — geography alone fixes the map; nothing to pre-commit or game. | Reproducible from a public seed; requires the seed-precommitment protocol (legislation Part I §4(b)(2)) to prevent gaming. |
| Population balance | Targeted at the population quantile but **not enforced** — no polish/retry, so a map can carry markedly under-populated districts. | Soft ±5 % **enforced** via polish + multi-seed retry. |
| Compactness | *Is* the objective — shortest straight cut, true geometry. | Emergent; biased compact by a graph-isoperimetric gate (§4.6). |
| Contiguity | **Not guaranteed** — straight cuts can disconnect a district; only small specks are repaired. | **Guaranteed by construction** — cuts a spanning tree of the adjacency graph. |
| Community of interest | Zero slack — a straight line ignores all geography. | Some slack — cuts ride the adjacency graph, so rivers/county lines can fall on real edges. |
| Speed | Instant (pure recursion, no chain). | Burn-in + retries; tens of seconds for 50 states. |
| Distribution / litigation use | None — a single map; cannot answer "is the enacted map an outlier?" | Reseed → ensemble → outlier analysis (the MGGG/Mattingly litigation standard; §4.7, §6.4). |
| Auditability | A child can verify it: "shortest straight line, equal halves, repeat." | Requires understanding Markov-chain mixing and the seed protocol. |

**Which is the better neutral baseline?** Shortest-splitline is the stronger *anti-gerrymandering primitive*: it cannot be gamed without changing the published rule itself, it needs no seed-governance machinery, and its compactness is provable rather than emergent — which is why it is the dashboard default. Its costs are real and disclosed: it can produce a non-contiguous or markedly under-populated district, and it will bisect a community without hesitation — and, having no polish or retry, it does not repair any of these. ReCom is the stronger *scientific instrument*: population balance, contiguity, and compactness are all actively enforced, its cuts respect real adjacency, and — decisively — reseeding produces an *ensemble*, which is the only way to ask whether a real enacted map is a statistical outlier. Neither is "more neutral"; they make different, fully-stated trade-offs, and the dashboard lets the reader switch between them and see both. (See §6.6: under *either* method, *neutral* is not the same as *proportional*.)

---

## 5. Geometric rendering

### 5.1 District boundary tracing

Each district is a set of unit polygons. To draw its outline, we trace the boundary:

```
traceBoundary(polygons):
  collect every directed edge of every ring of every polygon into a map
  an edge a→b is INTERIOR iff its reverse b→a is also in the map
    (two same-district polygons share that border, going opposite ways)
  remaining edges (no reverse) form the outer boundary
  chain consecutive boundary edges into closed loops via vertex matching
  return the loops
```

Floating-point precision is non-trivial here. Topojson's encode/decode cycle introduces ~0.05 SVG-unit drift between adjacent polygons that should share an exact edge. We hash edge endpoints to a 0.05-pixel grid (`COORD_QUANT = 20`) before matching, which is fine enough to keep distinct vertices distinct at tract granularity but coarse enough to merge sub-pixel float drift between counties.

### 5.2 Slab-cut artifact handling

When a metropolitan county is slab-cut into fragments and those fragments end up in different districts, the cut between them appears as a real district boundary edge — but it's actually arbitrary geometry, not real geography. We detect these edges:

```
findSlabCutEdges(units):
  group units by parent FIPS (county code)
  for each FIPS with multiple fragments:
    collect their directed edges
    an edge a→b is a SLAB CUT iff its reverse b→a appears in the same FIPS group
    (two same-county fragments share that boundary)
  return the set of slab-cut edge keys
```

The renderer then draws district boundaries in two passes:
1. Real geographic boundaries (district outline minus slab cuts) at full weight, solid stroke
2. Slab-cut boundaries at lighter weight with dashed stroke

Visually, the user sees every district's complete outline but can immediately distinguish organic boundaries from population-balance approximations.

### 5.3 Pole of inaccessibility for label placement

District number labels need to sit visibly inside the district. The right point is the **pole of inaccessibility** — the point inside the polygon furthest from the boundary. We use the standard polylabel quad-tree refinement (Vladimir Agafonkin / Mapbox 2016; <https://github.com/mapbox/polylabel>) on the merged district loops:

```
polylabel(loops, precision):
  start with state-bbox-sized cell, seed with bbox-center
  priority queue ordered by potential maximum distance
  at each step:
    pop best cell, subdivide into 4 children
    compute each child's distance from boundary (via point-to-segment)
    push children with potential > current best
  return the cell center with maximum distance
```

The returned distance is a useful measure: if it's smaller than half the label plate height, the label won't fit cleanly inside the district.

### 5.4 Two-tier labeling: inline + external with leader lines

States with many small districts (CA: 52, NY: 26, FL: 28) can't fit every district label inline at its pole. We use a two-tier strategy:

1. **Inline labels** — districts with sufficient pole-clearance get a pill-shaped plate at their pole position. Plates are sized for the digit count (single-digit = circle, multi-digit = pill).
2. **External labels** — districts that don't fit get a plate in a side column (left or right of the state, depending on which side the district's pole is on), connected to the district's pole-point by a thin leader line ending in a small dot.

A greedy collision-avoidance pass (process by descending clearance) ensures no two inline plates overlap. The viewBox auto-expands horizontally to accommodate external columns.

### 5.5 Color palette

D-share is mapped to color via a three-stop piecewise-RGB scheme:

- Strong R (≤33% D): saturated brick red `rgb(155, 41, 43)`
- Tossup (~50% D): warm cream `rgb(238, 222, 198)` (matches dashboard background)
- Strong D (≥67% D): saturated navy `rgb(28, 73, 138)`

Linear interpolation between stops, with a non-linear ease curve `mix' = 1 - (1-mix)^1.6` that pulls competitive districts (52% D, 53% D, etc.) noticeably away from the cream midpoint. This avoids the muddy purple/green that naive linear interpolation produces between red and blue.

The visible range maps `dShare ∈ [0.30, 0.70]` to t ∈ [0, 1]; values outside that range clamp to the endpoints. US districts rarely fall outside that range, but when they do (very safe seats), they pin to the strongest partisan color rather than going darker.

---

## 6. Limitations and honest caveats

The dashboard makes a number of modeling choices and trade-offs. We disclose them all here so the reader can evaluate them rather than discover them.

### Data limitations

### 6.1 Tract-level partisan vote totals are modeled, not measured.

No federal authority publishes precinct-to-tract election crosswalks, so tract-level vote totals don't exist as direct observations. The dashboard disaggregates official county D and R totals to tracts using the population-density model in §3.4 (logit-space shift proportional to log-density-relative-to-county-median, rescaled per-county-per-year so tract sums match official county totals exactly). This adds the strongest non-racial geographic predictor of partisanship to the within-county picture without inventing votes. **A more complete model would incorporate race (Census table B02001), Hispanic origin (B03002), and educational attainment (B15003).** The build pipeline for that fetch is straightforward given a Census API key; we left it for a future iteration to avoid a key dependency in the deployment.

### 6.2 Midterm-cycle vote totals are modeled at the per-state level.

For the six midterm cycles (2002, 2006, 2010, 2014, 2018, 2022), the dashboard takes each state's real two-party U.S. House aggregate D-share and applies it as a logit-space swing to the nearest presidential year's county pattern. **Presidential cycles use real official county-level returns; midterm cycles use a model.** The model captures the real state-level swing geographically (per-state, not nationwide) but holds within-state county rankings constant at the base presidential year. Midterm rows are labeled "MODELED" in the dashboard headline. Replacing this with precinct-aggregated county-level House data (MIT EDSL precinct dataset, 2016+) is a documented future enhancement.

### 6.3 The 2020 Decennial uses differential privacy.

The Census Bureau's TopDown algorithm injects calibrated noise into block-level counts before aggregating to tracts and counties (Hawes 2020, "Implementing differential privacy: Seven lessons from the 2020 United States Census," *Harvard Data Science Review* 2(2)). P1 totals at the tract level are accurate to within a few percent in expectation, but small tracts can have noticeable noise. The ±5 % population-balance target is well above the noise floor, so the algorithm's deviation metric is unaffected in practice; for individual tract D-shares the differential-privacy noise contributes a small additional layer of uncertainty on top of the density model.

### Algorithmic limitations

### 6.4 Single chain per seed, not a litigation-grade ensemble.

Each seed produces ONE map, not a distribution. Litigation-grade analysis under MGGG/Mattingly methodology runs 10,000–100,000 ReCom maps and uses ensemble statistics as the baseline against which real maps are compared. The dashboard's purpose is visualization, not litigation — reseed to see how the result varies. (The legislation Part I, Sec. 6 does require publication of the full chain history, which permits any third party to construct ensembles from the official record.)

### 6.5 Compactness is enforced graphically, not via Polsby–Popper.

The dashboard uses a graph-isoperimetric compactness gate on every ReCom-accepted cut (§4.6), plus a partition-level selection rule that prefers low-cross-edge-count partitions among all retries that hit ±5 %. The graph-isoperimetric ratio is the discrete analog of Polsby–Popper (`4πA/P²`) appropriate to graph partitioning. We do not compute geometric Polsby–Popper directly because it adds runtime cost without changing chain semantics; the graph metric correlates well with the geometric one and is cheap. States with statutory geometric-compactness requirements (e.g., Iowa's Reock-score test) would need a geometry-aware variant in the reference specification, which the Independent Districting Standards Board would publish — see legislation Part I, Sec. 5(c)(2)(D).

### 6.6 Neutral maps are not symmetric maps.

A common misconception is that an unbiased redistricting algorithm should produce seat shares that match popular-vote shares — i.e., 50/50 popular vote → 50/50 seat split. This is not what neutrally-drawn maps produce in the contemporary U.S., and the dashboard's output reflects that. Chen and Rodden (2013), "Unintentional gerrymandering: Political geography and electoral bias in legislatures," *Quarterly Journal of Political Science* 8(3), demonstrated that the geographic distribution of partisans produces a structural 2–3 point seat advantage for Republicans even under neutrally-drawn maps, because Democratic voters cluster in dense urban areas where they win districts by lopsided margins (the 30-point "wasted" cushion of an 80/20 district), while Republican voters distribute more evenly across suburbs and rural areas (winning 55/45 districts where their votes "go further" in seat-conversion terms). This is a property of *geography*, not of any drawing method. ReCom maps reproduce it; so does any contiguous, equal-population partition. A close popular-vote year (2016: 50.4 D / 49.6 R two-party) can therefore land at a seat split anywhere from D+5 to R+15 across the seed distribution, with the median outcome typically R-favored. **Treating popular-vote-vs.-seat-share parity as the test of "neutrality" assumes a symmetry that the underlying geography does not provide.** See also Goedert (2014), "Gerrymandering or geography? How Democrats won the popular vote but lost the Congress in 2012," *Research & Politics* 1(1).

### Policy limitations (what the algorithm deliberately doesn't do)

### 6.7 Communities of interest are not preserved.

The algorithm has no notion of a "neighborhood," "school district," "historic ethnic enclave," or "metropolitan area." Some communities will be split across districts; some will be unified. This is a known cost. The alternative is to let drafters decide which communities count, which is precisely the discretionary lever that produces gerrymandering. Legislators who want communities-of-interest preservation can add it as a post-algorithmic adjustment under a separate, narrow statutory framework — but the algorithm itself is deliberately blind to community identity.

### 6.8 The algorithm does not consider race or ethnicity.

The Supreme Court's decision in *Louisiana v. Callais* (April 2026) effectively eliminated Voting Rights Act §2 enforcement for redistricting. The dashboard's algorithm consumes no racial data and has no race-conscious adjustment step, consistent with the post-*Callais* legal regime. If future legislation or judicial rulings reinstate race-conscious redistricting requirements, those would be addressed by amending the Algorithm Reference Specification (legislation Sec. 5) — not by overriding the algorithm's output.

### 6.9 Polsby–Popper / Reock / other shape-based statutory criteria are not checked.

Some states have geometric-compactness statutes that use Polsby–Popper, Reock, or similar continuous-geometry metrics. The dashboard's graph-isoperimetric gate is a discrete proxy that correlates well but isn't identical. States with binding geometric-compactness statutes would have those criteria added to the reference specification at the Board's discretion under legislation Sec. 5(c)(2)(D); the dashboard does not enforce them today.

### What the dashboard verifies

### 6.10 ±5 % population balance.

*Karcher v. Daggett*, 462 U.S. 725 (1983), held that even small population deviations in congressional districts require justification; modern courts generally accept ±0.5 % to ±1 %, while ±5 % is the looser bound the Department of Justice has flagged as the upper end of "tolerable" *if* justified by traditional districting criteria. Real states routinely draw maps inside ±0.5 %. **The dashboard delivers ±5 % in all 44 multi-seat states on default settings, with a typical worst-state deviation in the 1–3 % range and a per-state median below 1 %.** This is achieved via the auto-upgrade-to-tract pipeline (§3.3): every state's partition runs at tract granularity (~3,500 people per unit), so the unit graph has enough degrees of freedom to land balanced partitions reliably. The variance metric in the headline reports the worst-state deviation in real time so the reader can verify directly.

---

## 7. References

- Smith, Warren D. (2007). "Gerrymandering and a cure: the shortest-splitline algorithm." rangevoting.org/GerryExamples.html (shortest-splitline; the dashboard default).
- DeFord, Duchin, Solomon (2021). "Recombination: A family of Markov chains for redistricting." *Harvard Data Science Review* 3(1).
- Najt, Solomon, Wachs (2019). "Complexity and geometry of sampling connected graph partitions." arXiv:1908.08881.
- Wilson (1996). "Generating random spanning trees more quickly than the cover time." STOC '96.
- Propp, Wilson (1998). "How to get a perfectly random sample from a generic Markov chain and generate a random spanning tree of a directed graph." *J. Algorithms* 27(2).
- Chen, Rodden (2013). "Unintentional gerrymandering: Political geography and electoral bias in legislatures." *Quarterly Journal of Political Science* 8(3).
- Goedert (2014). "Gerrymandering or geography? How Democrats won the popular vote but lost the Congress in 2012." *Research & Politics* 1(1).
- Bangia, Graves, Herschlag, Kang, Luo, Mattingly, Ravier (2017). "Redistricting: Drawing the Line." arXiv:1704.03360.
- Herschlag, Ravier, Mattingly (2017). "Evaluating partisan gerrymandering in Wisconsin." arXiv:1709.01596.
- Cain et al. (2018). "A reasonable bias method for redistricting." arXiv:1804.07003.
- Hawes (2020). "Implementing differential privacy: Seven lessons from the 2020 United States Census." *Harvard Data Science Review* 2(2).
- Agafonkin, Vladimir (2016). "polylabel: a fast algorithm for finding the pole of inaccessibility of a polygon." Mapbox.
- U.S. Census Bureau (2021). "2020 Census Apportionment Results."
- MIT Election Data and Science Lab. "U.S. President 1976-2024" county-level returns.

## 8. Court cases referenced

- Wesberry v. Sanders, 376 U.S. 1 (1964) — one person, one vote in House districts
- Karcher v. Daggett, 462 U.S. 725 (1983) — congressional population deviations require justification
- Common Cause v. Rucho, 318 F. Supp. 3d 777 (M.D.N.C. 2018) — early ReCom-based litigation
- Rucho v. Common Cause, 588 U.S. 684 (2019) — partisan gerrymandering non-justiciable in federal court
