/**
 * model-precinct-votes.mjs — branch-only (explore/precinct-data).
 *
 * The precinct substrate has REAL counted returns for only the four
 * presidential precinct cycles (2008/2012/2016/2020). Phase 7 makes the
 * dashboard precinct-only, so we MODEL precinct-level results for the
 * other nine cycles (2000, 2004, 2024 presidential + the six midterms)
 * from the county-level data we already have, using the four observed
 * cycles to learn each precinct's partisan relationship to its county
 * and how it drifts election-over-election.
 *
 * Model (precinct fixed-effect + shrunk linear trend, rescaled to the
 * official county totals — the same discipline §3.4 uses for tracts and
 * build-midterm-votes uses for counties):
 *
 *   For precinct p in county c, observed year y in {2008,12,16,20}:
 *     L_p(y) = logit(Dshare_p(y)) − logit(Dshare_c(y))      (lean vs county)
 *     s_p(y) = twoParty_p(y) / twoParty_c(y)                 (turnout share)
 *   Fit over the observed years:  L_p(y) ≈ α_p + β_p·(y − ȳ)
 *     α_p = mean lean (persistent partisan character)
 *     β_p = OLS slope (the precinct's OWN election-over-election drift —
 *           e.g. suburb→D / rural→R realignment)
 *   s̄_p = mean observed turnout share (county-pop share if never observed)
 *
 *   For a target cycle Y (county D/R known for all 13 cycles):
 *     λ = 1 − min(1, yearsOutside(2008..2020) / 12)   (damp extrapolation;
 *         =1 for the in-window midterms 2010/14/18, <1 for 2000/04/24…)
 *     ŷ_logit = logit(Dshare_c(Y)) + α_p + λ·β_p·(Y − ȳ)   (clipped ±6)
 *     p̂ = sigmoid(ŷ_logit);  turnout_p = s̄_p · twoParty_c(Y)
 *     rawD = turnout_p·p̂,  rawR = turnout_p·(1−p̂)
 *   Then per county per year rescale so Σ rawD = official county D and
 *   Σ rawR = official county R EXACTLY — county-level truth is preserved
 *   bit-for-bit; only the within-county distribution is modeled.
 *
 * Writes the nine modeled years into each precinct's `v`, sets
 * pj.years to all 13 and pj.modeledYears so the app/methodology can
 * label them MODELED (midterms doubly so — their county figure is
 * itself the build-midterm-votes per-state-swing model).
 *
 * Usage: node scripts/model-precinct-votes.mjs            (all states)
 *        node scripts/model-precinct-votes.mjs UT FL       (subset USPS)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const DIR = ROOT + 'public/data/precincts';
const VOTES = ROOT + 'public/data/votes';

// Nominal real precinct cycles. DRA's 2020-VTD compilation, however, lacks
// precinct-level returns for SOME of these in SOME states — specifically
// 2012 in the seven single-seat states below: precinct boundaries changed,
// so 2012 returns can't be mapped onto 2020 VTDs. "Observed" is therefore
// computed PER STATE; the missing cycle is modeled like any other (it is
// interpolation, not extrapolation — 2012 sits inside 2008..2020, λ=1).
//
// This is keyed off the KNOWN, stable, documented (methodology §3.5) DRA
// gap rather than "does the file have nonzero votes for this cycle":
// after a first modeling pass the file DOES carry a (synthetic) 2012, so
// a nonzero-detection would silently promote modeled data to "observed"
// on re-run and contaminate the trend fit. Keying off the fixed gap set
// makes the pass idempotent and keeps the fit on truly-observed cycles
// only, exactly as §3.5 describes.
const OBS = [2008, 2012, 2016, 2020];
const ALL = [2000, 2002, 2004, 2006, 2008, 2010, 2012,
             2014, 2016, 2018, 2020, 2022, 2024];
// (USPS) → set of OBS cycles DRA's 2020-VTD source does not carry.
const NO_REAL = { 2012: new Set(['AK', 'DE', 'MT', 'ND', 'SD', 'VT', 'WY']) };
const clip = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// County two-party D/R per year, indexed by 5-digit FIPS. votes/<y>.json
// is { fips: [d, r, total] }.
const countyByYear = {};
for (const y of ALL) {
  countyByYear[y] = JSON.parse(readFileSync(`${VOTES}/${y}.json`, 'utf8'));
}

const want = process.argv.slice(2);
const files = readdirSync(DIR).filter((f) => /^\d+\.json$/.test(f)).sort();

for (const f of files) {
  const pj = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
  const st = pj.stateCode;
  if (want.length && !want.includes(st)) continue;
  const P = pj.precincts;

  // Per-state observed set = the nominal real cycles DRA actually carries
  // for this state (= OBS minus the documented gap). Every other cycle —
  // including a real one a state is missing — is modeled. For the 43
  // full-data states this is exactly OBS → ȳ=2014, bit-identical output;
  // only the 7 single-seat states that lack real 2012 differ (2012 is
  // modeled, and never used as a fit anchor — idempotent across re-runs).
  const obsSt = OBS.filter((y) =>
    !(NO_REAL[y] && NO_REAL[y].has(st)) &&
    P.some((p) => p.v && p.v[y] && (p.v[y][0] || p.v[y][1])));
  const obsSet = new Set(obsSt);
  const modeledSt = ALL.filter((y) => !obsSet.has(y));
  const ybar = obsSt.reduce((s, y) => s + y, 0) / obsSt.length;

  // Per-county population (for the turnout-share fallback when a precinct
  // never reported in any observed cycle).
  const cPop = {};
  for (const p of P) { const cf = String(p.id).slice(0, 5); cPop[cf] = (cPop[cf] || 0) + (p.pop || 0); }

  // ---- Pass 1: fit α_p, β_p, s̄_p per precinct from the observed cycles.
  const fit = new Array(P.length);
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    const cf = String(p.id).slice(0, 5);
    const leans = [], shares = [], xs = [];
    for (const y of obsSt) {
      const pv = p.v && p.v[y]; const cv = countyByYear[y][cf];
      if (!pv || !cv) continue;
      const pd = pv[0], pr = pv[1], p2 = pd + pr;
      const cd = cv[0], cr = cv[1], c2 = cd + cr;
      if (p2 <= 0 || c2 <= 0) continue;
      const ps = clip(pd / p2, 0.02, 0.98);
      const cs = clip(cd / c2, 0.02, 0.98);
      leans.push(logit(ps) - logit(cs));
      shares.push(p2 / c2);
      xs.push(y - ybar);
    }
    let alpha = 0, beta = 0;
    if (leans.length === 1) { alpha = leans[0]; }
    else if (leans.length >= 2) {
      const n = leans.length;
      const mx = xs.reduce((s, v) => s + v, 0) / n;
      const ml = leans.reduce((s, v) => s + v, 0) / n;
      let sxx = 0, sxy = 0;
      for (let k = 0; k < n; k++) { sxx += (xs[k] - mx) ** 2; sxy += (xs[k] - mx) * (leans[k] - ml); }
      beta = sxx > 1e-9 ? sxy / sxx : 0;
      alpha = ml - beta * mx; // == mean lean (mx≈0) but exact for any obs set
    }
    const sbar = shares.length
      ? shares.reduce((s, v) => s + v, 0) / shares.length
      : (cPop[cf] > 0 ? (p.pop || 0) / cPop[cf] : 0);
    fit[i] = { cf, alpha, beta, sbar };
  }

  // ---- Pass 2: predict + per-county rescale for each modeled year.
  for (const Y of modeledSt) {
    const outside = Math.max(0, 2008 - Y, Y - 2020);
    const lambda = 1 - Math.min(1, outside / 12); // damp far extrapolation
    const cY = countyByYear[Y];
    const acc = {}; // cf → { rD, rR }
    const raw = new Array(P.length);
    for (let i = 0; i < P.length; i++) {
      const { cf, alpha, beta, sbar } = fit[i];
      const cv = cY[cf];
      if (!cv) { raw[i] = null; continue; }
      const cd = cv[0], cr = cv[1], c2 = cd + cr;
      if (c2 <= 0) { raw[i] = [0, 0]; continue; }
      const cs = clip(cd / c2, 0.02, 0.98);
      const lg = clip(logit(cs) + alpha + lambda * beta * (Y - ybar), -6, 6);
      const ph = sigmoid(lg);
      const turnout = sbar * c2;
      const rD = turnout * ph, rR = turnout * (1 - ph);
      raw[i] = [rD, rR];
      (acc[cf] ||= { rD: 0, rR: 0 });
      acc[cf].rD += rD; acc[cf].rR += rR;
    }
    for (let i = 0; i < P.length; i++) {
      const r = raw[i]; const p = P[i];
      if (!r) { (p.v ||= {}); p.v[Y] = [0, 0]; continue; }
      const cf = fit[i].cf; const cv = cY[cf]; const a = acc[cf];
      const cd = cv ? cv[0] : 0, cr = cv ? cv[1] : 0;
      const sD = a && a.rD > 0 ? cd / a.rD : 0;
      const sR = a && a.rR > 0 ? cr / a.rR : 0;
      (p.v ||= {});
      p.v[Y] = [Math.round(r[0] * sD), Math.round(r[1] * sR)];
    }
  }

  pj.years = ALL.slice();
  pj.modeledYears = modeledSt.slice();
  writeFileSync(`${DIR}/${f}`, JSON.stringify(pj));

  // Sanity line: state two-party D-share, observed 2020 vs modeled 2024
  // (should track the county-level shift), and a modeled midterm.
  const sh = (y) => {
    let d = 0, r = 0;
    for (const p of P) { const v = p.v && p.v[y]; if (v) { d += v[0]; r += v[1]; } }
    return d + r > 0 ? (100 * d / (d + r)).toFixed(1) + '%D' : '—';
  };
  console.log(`  ${st} (${pj.fips}): D-share 2020=${sh(2020)} 2024=${sh(2024)} ` +
    `2018=${sh(2018)} 2004=${sh(2004)} 2000=${sh(2000)}  (+${modeledSt.length} modeled cycles)`);
}
console.log('precinct votes modeled →', DIR);
