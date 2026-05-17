/**
 * build-enacted.mjs — branch-only (explore/precinct-data).
 *
 * Phase 7.2: the ACTUAL enacted congressional districts, every cycle, so
 * the dashboard can show "what the legislatures/courts actually drew"
 * side-by-side with the algorithmic (Splitline / ReCom) maps.
 *
 * Source: U.S. Census Bureau cartographic-boundary CD shapefiles — the
 * official district geometry per Congress. Census's naming changed three
 * times across our range, so the year→file map is explicit and every URL
 * below was probed live (real .shp, not a soft-404 HTML stub):
 *
 *   2000  107th  PREVGENZ cd99_107      (1990-census map; 2000 election)
 *   2002  108th  PREVGENZ cd99_108      (2000-census map)
 *   2004  109th  PREVGENZ cd99_109      (TX 2003 mid-decade redraw baked in)
 *   2006  110th  PREVGENZ cd99_110
 *   2008  111th  PREVGENZ cd99_110  ↩   reuse: no 2006→2010 national redraw;
 *   2010  112th  PREVGENZ cd99_110  ↩   the 2000-census map's end state.
 *   2012  113th  GENZ2013 cb_2013_cd113 (first 2010-census map)
 *   2014  114th  GENZ2014 cb_2014_cd114
 *   2016  115th  GENZ2016 cb_2016_cd115 (FL/NC/VA 2016 court redraws)
 *   2018  116th  GENZ2018 cb_2018_cd116 (PA 2018 court redraw)
 *   2020  117th  GENZ2018 cb_2018_cd116 ↩ reuse: Census never published a
 *                                          cd117 cb; 2010-census end state.
 *   2022  118th  GENZ2022 cb_2022_cd118 (first 2020-census map)
 *   2024  119th  GENZ2024 cb_2024_cd119
 *
 * The two ↩ reuses are the legally-correct lines for those elections:
 * no nationwide redistricting occurred between the source cycle and the
 * target cycle within that census decade. (Methodology §3.6 documents
 * this honestly, consistent with the project ethos.)
 *
 * Output: public/data/enacted/<fips>.json — SAME app coordinate space as
 * the precinct substrate (geoAlbersUsa().scale(1300).translate([487.5,
 * 305])), shaped to mirror <fips>-districts.json so the renderer reads it
 * with one branch:
 *   { fips, stateCode, byYear: {
 *       "2000": { seats, source, dists:[ { polys:[[[ [x,y]... ]]],
 *                                          v:{ "2000":[d,r] } } ] }, ... } }
 *
 * Each enacted district is colored by THAT cycle's precinct vote — every
 * precinct (real or §3.5-modeled) is assigned to the enacted district that
 * geographically contains its centroid (nearest-district fallback so no
 * vote is dropped → per-state totals match the algorithmic view exactly,
 * an apples-to-apples comparison).
 *
 * Usage: node scripts/build-enacted.mjs            (all states)
 *        node scripts/build-enacted.mjs MI NC       (subset USPS)
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { geoAlbersUsa } from 'd3-geo';
import mapshaper from 'mapshaper';
import { loadHouseReturns } from './lib/house-returns.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const OUT = ROOT + 'public/data/enacted';
const PRE = ROOT + 'public/data/precincts';
const TMP = ROOT + '.enacted-tmp';
const SH = { shell: 'bash' };
const bp = (p) => p.replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase());
const sh = (cmd) => execSync(cmd, SH);

// REAL per-district U.S. House results (MIT EDSL, 2000–2022). The Enacted
// view shows the real districts colored by the real House outcome — so the
// per-district winner IS the documented result, not a presidential proxy
// (methodology §3.6). Cycles MEDSL doesn't itemize (a few pre-2010
// uncontested seats) and 2024 (not in the 1976–2022 academic dataset)
// fall back to the two-party precinct lean, flagged `est`.
const HOUSE = loadHouseReturns(ROOT + 'data-cache/house_1976-2022.csv', 2000);

const proj = geoAlbersUsa().scale(1300).translate([487.5, 305]);
const QUANT = 100;
const q = (v) => Math.round(v * QUANT) / QUANT;
const SIMPLIFY_PCT = 22;

// USPS → 2-digit FIPS (the 50 states; DC/PR/territories deliberately absent
// — there is no precinct file for them and they elect no voting members).
const FIPS = { AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',
  FL:'12',GA:'13',HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',
  LA:'22',ME:'23',MD:'24',MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',
  NE:'31',NV:'32',NH:'33',NJ:'34',NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',
  OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',SD:'46',TN:'47',TX:'48',UT:'49',
  VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56' };
const FIPS_TO_USPS = Object.fromEntries(Object.entries(FIPS).map(([k, v]) => [v, k]));
const KEEP_FIPS = new Set(Object.values(FIPS));

// Source descriptors. `key` is the cache id (deduped download); `url` the
// probed-real zip; `member` the .shp basename inside it.
const PREVGENZ = (n) => ({
  key: `cd99_${n}`,
  url: `https://www2.census.gov/geo/tiger/PREVGENZ/cd/cd${n}shp/cd99_${n}_shp.zip`,
  member: `cd99_${n}.shp`,
});
const GENZ = (y, n, flat) => ({
  key: `cb_${y}_cd${n}`,
  url: `https://www2.census.gov/geo/tiger/GENZ${y}/${flat ? '' : 'shp/'}cb_${y}_us_cd${n}_500k.zip`,
  member: `cb_${y}_us_cd${n}_500k.shp`,
});
const SOURCES = {
  2000: PREVGENZ(107), 2002: PREVGENZ(108), 2004: PREVGENZ(109),
  2006: PREVGENZ(110), 2008: PREVGENZ(110), 2010: PREVGENZ(110),
  2012: GENZ(2013, 113, true), 2014: GENZ(2014, 114), 2016: GENZ(2016, 115),
  2018: GENZ(2018, 116), 2020: GENZ(2018, 116),
  2022: GENZ(2022, 118), 2024: GENZ(2024, 119),
};
const YEARS = Object.keys(SOURCES).map(Number).sort((a, b) => a - b);

// Non-voting / unassigned CD codes that are NOT a real district.
const NONVOTING = new Set(['ZZ', '98', '99', '--', '', null, undefined]);

function ringArea(r) {
  let a = 0;
  for (let i = 0, n = r.length, j = n - 1; i < n; j = i++)
    a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return Math.abs(a / 2);
}

// Area-weighted centroid of an app-space MultiPolygon (same formula the
// dissolve/partition scripts use → identical to the app's notion of where
// a precinct "is", so PIP assignment is consistent).
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

// Ray-cast point-in-polygon for a ring (even-odd).
function inRing(pt, ring) {
  let inside = false;
  const [px, py] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > py) !== (yj > py)) &&
        (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
// Point in MultiPolygon (outer ring true, minus any hole).
function inMulti(pt, polys, bbox) {
  if (bbox && (pt[0] < bbox[0] || pt[0] > bbox[2] || pt[1] < bbox[1] || pt[1] > bbox[3])) return false;
  for (const poly of polys) {
    if (!poly.length || !inRing(pt, poly[0])) continue;
    let hole = false;
    for (let h = 1; h < poly.length; h++) if (inRing(pt, poly[h])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

const quantRing = (ring) => {
  const r = [];
  for (const [x, y] of ring) {
    const qx = q(x), qy = q(y);
    if (!r.length || qx !== r[r.length - 1][0] || qy !== r[r.length - 1][1]) r.push([qx, qy]);
  }
  if (r.length >= 4 && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push(r[0]);
  return r.length >= 4 ? r : null;
};

// Download (cache) + unzip + mapshaper shp→geojson + group features into
// per-state enacted districts in app-projected space. Returns:
//   { [fips]: { codes:[...], dists:[ { polys, bbox } ] } }
// `dists` indexed 0..seats-1 in numeric CD order ("00" at-large → 1 dist).
const SRC_CACHE = new Map();
async function loadSource(src) {
  if (SRC_CACHE.has(src.key)) return SRC_CACHE.get(src.key);
  mkdirSync(TMP, { recursive: true });
  const zip = `${TMP}/${src.key}.zip`;
  const dir = `${TMP}/${src.key}`;
  if (!existsSync(`${dir}/${src.member}`)) {
    sh(`curl -sL -o "${bp(zip)}" "${src.url}"`);
    sh(`mkdir -p "${bp(dir)}" && cd "${bp(dir)}" && unzip -o "../${src.key}.zip" >/dev/null 2>&1`);
  }
  if (!existsSync(`${dir}/${src.member}`))
    throw new Error(`source ${src.key}: ${src.member} not found after unzip (bad URL?)`);

  const o = await mapshaper.applyCommands(
    `-i "${dir}/${src.member}" -o out.json format=geojson`, {});
  const gj = JSON.parse(o['out.json'] || o[Object.keys(o)[0]]);

  // Group raw lon/lat features by (state FIPS, CD code).
  const byState = {}; // fips → { code → [ [outer,...holes], ... ] }
  for (const ft of gj.features || []) {
    const pr = ft.properties || {};
    const sf = String(pr.STATE ?? pr.STATEFP ?? '').padStart(2, '0');
    if (!KEEP_FIPS.has(sf)) continue;
    let cd = pr.CD;
    if (cd == null) {
      const k = Object.keys(pr).find((kk) => /^CD\d+FP$/.test(kk));
      cd = k ? pr[k] : null;
    }
    cd = cd == null ? '' : String(cd);
    if (NONVOTING.has(cd)) continue;          // delegate/unassigned, not a CD
    const g = ft.geometry;
    if (!g) continue;
    const raw = g.type === 'MultiPolygon' ? g.coordinates
      : g.type === 'Polygon' ? [g.coordinates] : [];
    if (!raw.length) continue;
    const projd = [];
    for (const poly of raw) {
      const rings = [];
      for (const ring of poly) {
        const pr2 = [];
        for (const c of ring) { const p = proj(c); if (p) pr2.push([p[0], p[1]]); }
        if (pr2.length >= 4) rings.push(pr2);
      }
      if (rings.length) projd.push(rings);
    }
    if (!projd.length) continue;
    ((byState[sf] ||= {})[cd] ||= []).push(...projd);
  }

  const result = {};
  for (const [sf, byCd] of Object.entries(byState)) {
    let codes = Object.keys(byCd);
    // At-large: a lone "00" (modern) / "00"/"01" single → one district.
    const numeric = codes
      .map((c) => ({ c, n: parseInt(c, 10) }))
      .filter((o) => Number.isFinite(o.n))
      .sort((a, b) => a.n - b.n);
    if (!numeric.length) continue;
    const atLarge = numeric.length === 1; // "00" or single CD = whole state
    const dists = [];
    const orderedCodes = [];
    for (let i = 0; i < numeric.length; i++) {
      const polys = byCd[numeric[i].c];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const rings of polys) for (const r of rings) for (const [x, y] of r) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      dists.push({ polys, bbox: [minX, minY, maxX, maxY] });
      orderedCodes.push(numeric[i].c);
    }
    result[sf] = { codes: orderedCodes, dists, atLarge };
  }
  SRC_CACHE.set(src.key, result);
  return result;
}

// Topology-aware simplify + quantize the per-state district polygons for
// OUTPUT (shared arcs → adjacent districts keep coincident borders, like
// the precinct pipeline; PIP assignment uses the UNsimplified geometry).
async function simplifyState(dists) {
  const feats = dists.map((d, i) => ({
    type: 'Feature', properties: { d: i },
    geometry: { type: 'MultiPolygon', coordinates: d.polys },
  }));
  let fc;
  try {
    const res = await mapshaper.applyCommands(
      `-i in.json snap -simplify ${SIMPLIFY_PCT}% keep-shapes planar -o out.json format=geojson`,
      { 'in.json': JSON.stringify({ type: 'FeatureCollection', features: feats }) });
    fc = JSON.parse(res['out.json'] || res[Object.keys(res)[0]]);
  } catch { fc = { features: feats }; }     // fall back to unsimplified
  const out = dists.map(() => []);
  for (const ft of fc.features || []) {
    const di = ft.properties.d;
    const g = ft.geometry; if (!g || di == null) continue;
    const raw = g.type === 'MultiPolygon' ? g.coordinates
      : g.type === 'Polygon' ? [g.coordinates] : [];
    for (const poly of raw) {
      const rings = [];
      for (let ri = 0; ri < poly.length; ri++) {
        const qr = quantRing(poly[ri]);
        if (ri === 0 ? qr : (qr && ringArea(qr) > 0.04)) rings.push(qr);
      }
      if (rings.length && rings[0]) out[di].push(rings);
    }
  }
  // Guarantee no district vanishes (quantization can erase a tiny one):
  for (let i = 0; i < out.length; i++) if (!out[i].length) {
    for (const rings of dists[i].polys) {
      const r0 = quantRing(rings[0]); if (r0) { out[i].push([r0]); break; }
    }
  }
  return out;
}

const want = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });

// Precinct centroids per state are SOURCE-independent — cache once.
const PCT_CACHE = new Map();
function precinctData(fips) {
  if (PCT_CACHE.has(fips)) return PCT_CACHE.get(fips);
  const path = `${PRE}/${fips}.json`;
  if (!existsSync(path)) { PCT_CACHE.set(fips, null); return null; }
  const pj = JSON.parse(readFileSync(path, 'utf8'));
  const cent = pj.precincts.map((p) => multiPolygonCentroid(p.polys || []));
  PCT_CACHE.set(fips, { pj, cent });
  return PCT_CACHE.get(fips);
}

const targets = Object.values(FIPS)
  .filter((sf) => !want.length || want.includes(FIPS_TO_USPS[sf]))
  .sort();

for (const fips of targets) {
  const usps = FIPS_TO_USPS[fips];
  const pd = precinctData(fips);
  if (!pd) { console.log(`  ${usps} (${fips}): no precinct file — skip`); continue; }
  const { pj, cent } = pd;
  const P = pj.precincts;

  // Assignment precinct→district is the same for every year that shares a
  // source map, so compute it once per unique source key.
  const asnByKey = new Map();   // srcKey → { assign:Int32Array, outPolys }
  const out = { fips, stateCode: usps, byYear: {} };
  const t0 = Date.now();

  for (const year of YEARS) {
    const src = SOURCES[year];
    const sj = await loadSource(src);
    const st = sj[fips];
    if (!st || !st.dists.length) { continue; }
    const seats = st.dists.length;

    if (!asnByKey.has(src.key)) {
      const assign = new Int32Array(P.length).fill(-1);
      if (seats === 1) {
        assign.fill(0);
      } else {
        const dCent = st.dists.map((d) => multiPolygonCentroid(d.polys));
        for (let i = 0; i < P.length; i++) {
          const c = cent[i];
          let hit = -1;
          for (let d = 0; d < st.dists.length; d++)
            if (inMulti(c, st.dists[d].polys, st.dists[d].bbox)) { hit = d; break; }
          if (hit < 0) {                      // nearest-district fallback
            let best = 0, bd = Infinity;
            for (let d = 0; d < dCent.length; d++) {
              const dx = c[0] - dCent[d][0], dy = c[1] - dCent[d][1];
              const dd = dx * dx + dy * dy;
              if (dd < bd) { bd = dd; best = d; }
            }
            hit = best;
          }
          assign[i] = hit;
        }
      }
      const outPolys = await simplifyState(st.dists);
      // District population (2020-census precinct pop, source-fixed —
      // same every cycle that shares this map). Lets the state-detail
      // panel show the enacted plan's per-district population & deviation
      // (they ARE near-equipopulous by law — a fair point of comparison).
      const dpop = new Array(seats).fill(0);
      for (let i = 0; i < P.length; i++) {
        const d = assign[i]; if (d >= 0) dpop[d] += P[i].pop || 0;
      }
      asnByKey.set(src.key, { assign, outPolys, dpop });
    }
    const { assign, outPolys, dpop } = asnByKey.get(src.key);

    // Two-party precinct lean per district — kept ONLY as the fallback
    // shade for seats with no itemized real House return.
    const dv = Array.from({ length: seats }, () => [0, 0]);
    for (let i = 0; i < P.length; i++) {
      const d = assign[i]; if (d < 0) continue;
      const v = P[i].v && P[i].v[year]; if (!v) continue;
      dv[d][0] += v[0] || 0; dv[d][1] += v[1] || 0;
    }

    // The Enacted view's whole point: the real districts colored by the
    // REAL House outcome. Join Census CD code → integer district number →
    // MEDSL returns. Independent winners (e.g. Sanders-VT 2000–04) are
    // neither D nor R (v=[0,0], w='O') — matching how the official seat
    // table excludes them. Seats MEDSL doesn't itemize (a handful of
    // pre-2010 uncontested races) and 2024 (absent from the 1976–2022
    // dataset) fall back to the two-party precinct lean, flagged `est`.
    const hs = (HOUSE[year] || {})[usps] || {};
    let nEst = 0;
    const dists = outPolys.map((polys, d) => {
      const distNum = parseInt(st.codes[d], 10);   // 0 = at-large
      const hr = Number.isFinite(distNum) ? hs[distNum] : null;
      let v, w, est = false;
      if (hr) {
        if (hr.winner === 'O') { v = [0, 0]; w = 'O'; }
        else { v = [hr.d, hr.r]; w = hr.winner; }
      } else {
        v = dv[d];
        w = (v[0] > v[1]) ? 'D' : 'R';
        est = true; nEst++;
      }
      const o = { polys, pop: dpop[d], v: { [year]: v }, w };
      if (est) o.est = true;
      return o;
    });
    out.byYear[year] = { seats, source: src.key, dists, est: nEst || undefined };
  }

  writeFileSync(`${OUT}/${fips}.json`, JSON.stringify(out));
  const yk = Object.keys(out.byYear);
  const s00 = out.byYear[2000]?.seats, s12 = out.byYear[2012]?.seats,
        s22 = out.byYear[2022]?.seats;
  const dsh = (y) => {
    const b = out.byYear[y]; if (!b) return '—';
    let d = 0, r = 0; for (const x of b.dists) { const v = x.v[y]; d += v[0]; r += v[1]; }
    return d + r > 0 ? (100 * d / (d + r)).toFixed(1) + '%D' : '—';
  };
  console.log(`  ${usps} (${fips}): ${yk.length}/13 cycles  seats ` +
    `2000=${s00} 2012=${s12} 2022=${s22}  D-share 2000=${dsh(2000)} ` +
    `2012=${dsh(2012)} 2024=${dsh(2024)}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
console.log('enacted districts →', OUT);
