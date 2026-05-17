/**
 * add-splitline-national.mjs — branch-only (explore/precinct-data).
 *
 * The national PRECINCT view renders pre-dissolved district polygons from
 * public/data/precincts/<fips>-districts.json. build-precincts.mjs bakes
 * those at 2020 apportionment only, but the precinct cycles run on EARLIER
 * censuses (2008 → 2000 census, 2012/2016/2020 → 2010 census), and the
 * national view is now per-decade like the state-detail view. So the
 * national precinct map needs dissolves at the per-decade district counts,
 * for BOTH models.
 *
 * This is a fast ATTRIBUTE-MERGE (no DRA download): for each already-built
 * <fips>.json it runs the SAME runSplitline / runReCom the app uses
 * (scripts/lib/*.mjs, kept in sync with Dashboard.jsx) with the SAME
 * parameters build-precincts.mjs uses, at the apportionment of each
 * precinct-relevant census, and writes:
 *   distOut.byCensus = { "2000": { seats, splitline:{maxDev,dists},
 *                                  baked:{42,7,1337:{maxDev,dists}} },
 *                        "2010": { ... } }
 * into the existing <fips>-districts.json (legacy top-level keys kept).
 *
 * Usage: node scripts/add-splitline-national.mjs            (all states)
 *        node scripts/add-splitline-national.mjs MI NC       (subset USPS)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import mapshaper from 'mapshaper';
import { runSplitline } from './lib/partition.mjs';
import { runReCom } from './lib/recom.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const DIR = ROOT + 'public/data/precincts';

// Per-census apportionment — copied from Dashboard.jsx APPORTIONMENT
// (U.S. Census Bureau Table C1). Precinct cycles only ever touch the
// 2000 census (2008 election) and the 2010 census (2012/2016/2020).
const APPORTIONMENT = {
  2000: { AL: 7, AK: 1, AZ: 8, AR: 4, CA: 53, CO: 7, CT: 5, DE: 1, FL: 25,
    GA: 13, HI: 2, ID: 2, IL: 19, IN: 9, IA: 5, KS: 4, KY: 6, LA: 7,
    ME: 2, MD: 8, MA: 10, MI: 15, MN: 8, MS: 4, MO: 9, MT: 1, NE: 3,
    NV: 3, NH: 2, NJ: 13, NM: 3, NY: 29, NC: 13, ND: 1, OH: 18, OK: 5,
    OR: 5, PA: 19, RI: 2, SC: 6, SD: 1, TN: 9, TX: 32, UT: 3, VT: 1,
    VA: 11, WA: 9, WV: 3, WI: 8, WY: 1 },
  2010: { AL: 7, AK: 1, AZ: 9, AR: 4, CA: 53, CO: 7, CT: 5, DE: 1, FL: 27,
    GA: 14, HI: 2, ID: 2, IL: 18, IN: 9, IA: 4, KS: 4, KY: 6, LA: 6,
    ME: 2, MD: 8, MA: 9, MI: 14, MN: 8, MS: 4, MO: 8, MT: 1, NE: 3,
    NV: 4, NH: 2, NJ: 12, NM: 3, NY: 27, NC: 13, ND: 1, OH: 16, OK: 5,
    OR: 5, PA: 18, RI: 2, SC: 7, SD: 1, TN: 9, TX: 36, UT: 4, VT: 1,
    VA: 11, WA: 10, WV: 3, WI: 8, WY: 1 },
};
const CENSUSES = [2000, 2010];
const BAKE_SEEDS = [42, 7, 1337];
const stateSeed = (baseSeed, st) =>
  baseSeed * 1000 + st.charCodeAt(0) * 17 + st.charCodeAt(1);

function multiPolygonCentroid(polys) {
  let totA = 0, cx = 0, cy = 0;
  for (const poly of polys) for (const ring of poly) {
    let a = 0, x = 0, y = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      const cr = x1 * y2 - x2 * y1;
      a += cr; x += (x1 + x2) * cr; y += (y1 + y2) * cr;
    }
    a /= 2;
    const absA = Math.abs(a);
    if (absA > 1e-9) { x /= 6 * a; y /= 6 * a; totA += absA; cx += x * absA; cy += y * absA; }
  }
  return totA > 0 ? [cx / totA, cy / totA] : [0, 0];
}

const maxDevOf = (assignment, P, k) => {
  const dp = new Array(k).fill(0); let tot = 0;
  for (let i = 0; i < P.length; i++) { const d = assignment[i]; if (d < 0) continue; dp[d] += P[i].pop || 0; tot += P[i].pop || 0; }
  const tgt = tot / k; let mx = 0;
  for (const v of dp) { const dv = Math.abs(v - tgt) / (tgt || 1); if (dv > mx) mx = dv; }
  return mx;
};

async function dissolve(P, assignment, seats, years) {
  const feats = [], dv = {};
  for (let i = 0; i < P.length; i++) {
    const d = assignment[i]; if (d < 0) continue;
    feats.push({ type: 'Feature', properties: { d },
      geometry: { type: 'MultiPolygon', coordinates: P[i].polys } });
    const pv = P[i].v || {}; (dv[d] ||= {});
    for (const y of years) { const e = pv[y]; if (!e) continue; (dv[d][y] ||= [0, 0]); dv[d][y][0] += e[0]; dv[d][y][1] += e[1]; }
  }
  const dgeo = {};
  try {
    const res = await mapshaper.applyCommands(
      '-i d.json -dissolve2 d -o o.json format=geojson',
      { 'd.json': JSON.stringify({ type: 'FeatureCollection', features: feats }) });
    const fc = JSON.parse(res['o.json'] || res[Object.keys(res)[0]]);
    for (const ft of fc.features || []) {
      const g = ft.geometry; if (!g) continue;
      dgeo[ft.properties.d] = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    }
  } catch (e) { return null; }
  const dists = [];
  for (let d = 0; d < seats; d++) dists.push({ polys: dgeo[d] || [], v: dv[d] || {} });
  return dists;
}

const want = process.argv.slice(2);
const files = readdirSync(DIR).filter((f) => /^\d+\.json$/.test(f)).sort();

for (const f of files) {
  const pj = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
  const st = pj.stateCode;
  if (want.length && !want.includes(st)) continue;
  const fips = pj.fips || f.replace('.json', '');
  const distPath = `${DIR}/${fips}-districts.json`;
  let distOut;
  try { distOut = JSON.parse(readFileSync(distPath, 'utf8')); }
  catch { console.log(`  ${st}: no ${fips}-districts.json — skip`); continue; }

  const P = pj.precincts;
  const N = P.length;
  const years = pj.years || distOut.years || [2008, 2012, 2016, 2020];
  const cohesion = P.map((p) => String(p.id).slice(0, 5));
  const adjacency = pj.adjacency;
  const slUnits = P.map((p) => ({ pop: p.pop || 0, centroid: multiPolygonCentroid(p.polys || []), polygons: p.polys || [] }));
  const rcUnits = P.map((p) => ({ pop: p.pop || 0 }));
  distOut.byCensus ||= {};
  const t0 = Date.now();

  for (const census of CENSUSES) {
    const seats = (APPORTIONMENT[census] || {})[st] || 1;
    const block = { seats };

    // ---- Splitline (deterministic, one pass) ----
    let slAsn;
    if (seats > 1) slAsn = runSplitline(slUnits, adjacency, seats).assignment;
    else slAsn = new Int16Array(N);
    const slDists = await dissolve(P, slAsn, seats, years);
    if (slDists) block.splitline = { maxDev: +maxDevOf(slAsn, P, seats).toFixed(4), dists: slDists };

    // ---- ReCom (3 seeds, compactness ladder — mirror build-precincts) ----
    block.baked = {};
    if (seats > 1) {
      const burnIn = Math.max(400, Math.min(2200, Math.round(N * 0.12)));
      for (const bs of BAKE_SEEDS) {
        let best = null, bestDev = Infinity;
        for (const c of [0.9, 1.4, 2.2]) {
          const r = runReCom(rcUnits, adjacency, seats, stateSeed(bs, st),
            { burnIn, tolerance: 0.02, compactness: c, cohesion });
          if (!r) continue;
          const dev = maxDevOf(r.assignment, P, seats);
          if (dev < bestDev) { best = r; bestDev = dev; }
          if (dev <= 0.05) break;
        }
        if (!best) continue;
        const dists = await dissolve(P, best.assignment, seats, years);
        if (dists) block.baked[bs] = { maxDev: +bestDev.toFixed(4), dists };
      }
    } else {
      const triv = new Int16Array(N);
      const dists = await dissolve(P, triv, seats, years);
      for (const bs of BAKE_SEEDS) block.baked[bs] = { maxDev: 0, dists };
    }
    distOut.byCensus[census] = block;
  }

  writeFileSync(distPath, JSON.stringify(distOut));
  const s2000 = distOut.byCensus[2000].seats, s2010 = distOut.byCensus[2010].seats;
  console.log(`  ${st} (${fips}): byCensus 2000=${s2000}seats 2010=${s2010}seats ` +
    `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
console.log('per-census national dissolves merged →', DIR);
