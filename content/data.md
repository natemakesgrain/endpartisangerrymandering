# Data & sources

Every number on the dashboard, where it comes from, and — said plainly — which cycles are real and which are modeled. The full mathematics is in the [Methodology](/methodology); this page is the honest plain-English version.

## What the dashboard shows

For all thirteen U.S. House cycles from 2000 through 2024 (seven presidential, six midterm), three maps of the *same* partisan geography: the districts a state **actually enacted**, and two **neutral baselines** drawn from population and geography alone. Every map is built from real precinct building blocks; the comparison holds the votes fixed and changes only the lines.

## The precinct map

The substrate is the real **2020 voting-district (precinct) geometry and adjacency** for all 50 states, from **Dave's Redistricting** (`vtd_data`, sourced from the Voting and Election Science Team — public domain). Districts in every view are dissolved from these precincts, so the boundaries follow real precinct lines. Precincts are projected into the same Albers USA space as the rest of the map and clipped to the Census land mask, so open water reads as neutral rather than as a phantom district.

## Population

Each precinct carries its **2020 Decennial Census P.L. 94-171** population. The same 2020 population is used to balance districts in every cycle — precinct geographies simply do not exist before 2020 — which nudges where a balanced line falls but never changes the *number* of districts (that is fixed per decade by apportionment, below). This is disclosed as one of the modeling approximations, in the same class as the modeled cycles.

## The votes: what's real, what's modeled

Only **four** cycles have actually-counted precinct returns. The rest are modeled from the official **county** results, with every county's Democratic and Republican totals preserved exactly — only the split *within* a county across its precincts is inferred.

| Cycle | County figure | Precinct split |
|---|---|---|
| 2008, 2012, 2016, 2020 (pres.) | Real FEC-certified county returns | **Real counted precinct returns** |
| 2000, 2004, 2024 (pres.) | Real FEC-certified county returns | Modeled (§3.5) |
| 2002, 2006, 2010, 2014, 2018, 2022 (midterm) | **Modeled** U.S.-House county figure | Modeled (§3.5) — *doubly* modeled |

Modeled cycles are labelled **MODELED** in the headline and on the map. The midterms are *doubly* modeled and say so, because their county figure is itself an estimate (next section). The precinct model uses each precinct's learned partisan lean and election-over-election drift, fit on the four real cycles, then rescales so the county totals match the official figures bit-for-bit. County-level truth — and therefore the national popular vote — is always the real number.

## How the midterm cycles are extrapolated

U.S. House results are reported by congressional district, not by county, and counties are split across districts — so there is no national county-level House dataset. For each midterm we take each **state's real two-party U.S. House vote share** (MIT Election Data & Science Lab, 1976–2022) and apply a single per-state swing, in logit space, to the nearest presidential year's real county pattern — rescaled so the state's modeled total matches the actual state House vote exactly. This captures the genuine per-state swing (2018's large Democratic shift in California versus the much smaller one in Tennessee both fall out naturally) while holding each state's internal county ordering at the base presidential year.

Two honest corrections, stated because the project's premise is that the methodology matches the implementation:

- **State-affiliate Democratic lines count as Democratic.** Minnesota's DFL and North Dakota's Democratic-NPL appear under their own names in the source data; counting them correctly fixes a previously false near-0 %-Democratic North Dakota in 2014 and 2018.
- **No-contest states hold the presidential reference.** Where a major party did not field a candidate (SD 2022, ND 2022, VT 2002), a "two-party House share" is undefined; rather than swing the whole state to a fabricated ~0 %, the model holds that state's real presidential-era lean for that cycle and labels it modeled.

## The enacted maps

The real district lines are **U.S. Census Bureau cartographic-boundary congressional-district shapefiles**, one file per Congress, so mid-decade court-ordered redraws (Texas 2003, Florida/North Carolina 2016, Pennsylvania 2018) are captured. Each enacted district is colored by the **real U.S. House result** — per-district returns from the MIT EDSL U.S.-House dataset — and the enacted seat tally is pinned to the canonical **Clerk of the House** figures, so the enacted total *is* the official documented outcome, every cycle. One caveat: per-district 2024 House returns are not yet in the academic dataset, so 2024 districts are shaded by two-party lean while the 2024 seat tally is still the official result.

## Apportionment, per decade

The 435 seats are reapportioned after each census, governing elections two years later. The dashboard applies the exact per-decade count (Census Bureau Table C1):

| Election cycles | Governing census | Texas seats |
|---|---|---|
| 2000 | 1990 | 30 |
| 2002–2010 | 2000 | 32 |
| 2012–2020 | 2010 | 36 |
| 2022, 2024 | 2020 | 38 |

So 2004 splits each state into its 2000-census count and 2022 uses the 2020-census count; Montana is one district through 2020 and two from 2022. This applies in both the national and the state-detail views, under both neutral methods.

## Limitations

- **Nine of thirteen cycles' precinct splits are modeled**, not counted (the table above). County totals are exact; the within-county precinct distribution is an estimate.
- **Midterm county figures are themselves modeled** — a per-state House swing on a presidential base, not counted county House returns (which do not exist nationally).
- **2020 population is used for every cycle**, since pre-2020 precinct geographies do not exist.
- **2024 enacted districts are shaded by two-party lean**, pending per-district 2024 House returns; the 2024 seat tally is still the official result.
- The neutral baselines are **not** any state's official plan, and **not** a litigation-grade ensemble — they are reproducible baselines for comparison.
- The 2020 Census uses differential privacy; small-unit counts carry minor calibrated noise, well below the population-balance tolerance.

## Sources

- **Precinct geometry & returns** — Dave's Redistricting, `vtd_data` (VEST-sourced, public domain).
- **District lines** — U.S. Census Bureau cartographic-boundary congressional-district shapefiles (per Congress).
- **Population** — U.S. Census Bureau, 2020 Decennial P.L. 94-171.
- **County & U.S. House returns** — MIT Election Data & Science Lab ("U.S. President 1976–2024", "U.S. House 1976–2022"), via the stiles/presidential-elections and tonmcg county tabulations.
- **Shortest-splitline** — Warren D. Smith, *Gerrymandering and a cure: the shortest-splitline algorithm* (2007), [rangevoting.org](https://rangevoting.org/GerryExamples.html).
- **Recombination (ReCom)** — DeFord, Duchin & Solomon, *Recombination: A family of Markov chains for redistricting*, *Harvard Data Science Review* 3(1) (2021).

Full citations and the formal derivations are in the [Methodology](/methodology).
