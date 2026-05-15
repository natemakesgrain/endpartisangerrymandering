/**
 * build-precincts.mjs — EXPLORATION (branch explore/precinct-data only).
 *
 * Builds the precinct substrate for the alternative "Precinct" dashboard
 * view from Dave's Redistricting (DRA) `vtd_data` 2020 VTDs:
 *   https://github.com/dra2020/vtd_data  (public domain election data)
 *
 * Per state, DRA ships ONE self-contained GeoJSON whose features carry
 * geometry + real returns (datasets.E_{08,12,16,20}_PRES.{Dem,Rep}) +
 * 2020 census population (datasets.T_20_CENS.Total), plus a rook adjacency
 * graph keyed by GEOID20. No modeling/disaggregation — these are the
 * actual precinct vote counts.
 *
 * Output: public/data/precincts/<fips>.json — same coordinate space as the
 * app (us-atlas Albers USA, geoAlbersUsa().scale(1300).translate([487.5,
 * 305]); verified to match the shipped tract files within ~2 units), in a
 * compact shape buildPrecinctUnits() consumes directly:
 *   { stateCode, fips, years:[...], n,
 *     precincts:[{ id, pop, v:{2008:[d,r],...}, polys:[[[ [x,y]... ]]] }],
 *     adjacency:[[idx...]] }
 *
 * Usage:  node scripts/build-precincts.mjs            (default state set)
 *         node scripts/build-precincts.mjs MI PA WI   (explicit states)
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { geoAlbersUsa } from 'd3-geo';
import { runReCom } from './lib/recom.mjs';

// 2020-apportionment House seats (copied from Dashboard.jsx SEATS_BY_STATE
// — must match so the baked partition equals what the app would compute).
const SEATS = {
  AL: 7, AK: 1, AZ: 9, AR: 4, CA: 52, CO: 8, CT: 5, DE: 1, FL: 28,
  GA: 14, HI: 2, ID: 2, IL: 17, IN: 9, IA: 4, KS: 4, KY: 6, LA: 6,
  ME: 2, MD: 8, MA: 9, MI: 13, MN: 8, MS: 4, MO: 8, MT: 2, NE: 3,
  NV: 4, NH: 2, NJ: 12, NM: 3, NY: 26, NC: 14, ND: 1, OH: 15, OK: 5,
  OR: 6, PA: 17, RI: 2, SC: 7, SD: 1, TN: 9, TX: 38, UT: 4, VT: 1,
  VA: 11, WA: 10, WV: 2, WI: 8, WY: 1,
};
// Seeds to pre-bake. The app derives a per-state seed exactly this way in
// useStatePrecinctPartition; baking the same derivation lets the national
// precinct view render baked districts with NO in-browser ReCom.
const BAKE_SEEDS = [42, 7, 1337];
const stateSeed = (baseSeed, st) =>
  baseSeed * 1000 + st.charCodeAt(0) * 17 + st.charCodeAt(1);

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const OUT = ROOT + 'public/data/precincts';
const TMP = ROOT + '.precinct-tmp';
// execSync defaults to cmd.exe on Windows (no curl/unzip, breaks on
// forward-slash paths). Force git-bash and translate C:/x → /c/x.
const SH = { shell: 'bash' };
const bp = (p) => p.replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase());
const sh = (cmd) => execSync(cmd, SH);
const PRES_YEARS = [2008, 2012, 2016, 2020];
const SIMPLIFY_TOL = 0.06;   // app units (~90 m) Douglas–Peucker tolerance
const QUANT = 100;           // 2-decimal coordinate quantization

// USPS → 2-digit state FIPS
const FIPS = { AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',
  FL:'12',GA:'13',HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',
  LA:'22',ME:'23',MD:'24',MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',
  NE:'31',NV:'32',NH:'33',NJ:'34',NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',
  OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',SD:'46',TN:'47',TX:'48',UT:'49',
  VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56' };

// Default: the competitive battlegrounds + the three biggest states. The
// architecture falls back to the model substrate for any state without a
// precinct file, so this set is enough to exercise the feature end-to-end.
const DEFAULT_STATES = ['MI','WI','PA','GA','AZ','NV','NC','NH','MN','VA','OH','FL','TX','CA'];

const proj = geoAlbersUsa().scale(1300).translate([487.5, 305]);

function dp(points, tol) {                       // Douglas–Peucker
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    let dx = bx - ax, dy = by - ay, dmax = 0, idx = -1;
    const len2 = dx * dx + dy * dy || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const t = ((px - ax) * dx + (py - ay) * dy) / len2;
      const cx = ax + t * dx, cy = ay + t * dy;
      const d2 = (px - cx) ** 2 + (py - cy) ** 2;
      if (d2 > dmax) { dmax = d2; idx = i; }
    }
    if (dmax > t2 && idx !== -1) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}
const q = (v) => Math.round(v * QUANT) / QUANT;

function projectRing(ring, raw = false) {
  const pts = [];
  for (const [lon, lat] of ring) {
    const p = proj([lon, lat]);
    if (p) pts.push(p);
  }
  if (pts.length < 4) return null;
  const s = (raw ? pts : dp(pts, SIMPLIFY_TOL)).map(([x, y]) => [q(x), q(y)]);
  // drop consecutive dupes after quantization
  const r = [s[0]];
  for (let i = 1; i < s.length; i++)
    if (s[i][0] !== r[r.length - 1][0] || s[i][1] !== r[r.length - 1][1]) r.push(s[i]);
  if (r.length < 4) return null;
  if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) r.push(r[0]);
  return r.length >= 4 ? r : null;
}
function ringArea(r) {
  let a = 0;
  for (let i = 0, n = r.length, j = n - 1; i < n; j = i++)
    a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return Math.abs(a / 2);
}

function buildState(st) {
  const fips = FIPS[st];
  if (!fips) { console.log(`  skip ${st}: unknown`); return; }
  mkdirSync(TMP, { recursive: true });
  const zip = `${TMP}/${st}.zip`;
  const url = `https://raw.githubusercontent.com/dra2020/vtd_data/master/2020_VTD/${st}/Geojson_${st}.v06.zip`;
  sh(`curl -sL -o "${bp(zip)}" "${url}"`);
  sh(`cd "${bp(TMP)}" && unzip -o "${st}.zip" -d "${st}" >/dev/null 2>&1`);
  const dir = `${TMP}/${st}`;
  const files = sh(`ls "${bp(dir)}"`).toString().trim().split(/\s+/);
  const gjFile = files.find((f) => /datasets\.geojson$/.test(f));
  const grFile = files.find((f) => /_graph\.json$/.test(f));
  const gj = JSON.parse(readFileSync(`${dir}/${gjFile}`, 'utf8'));
  const graph = grFile ? JSON.parse(readFileSync(`${dir}/${grFile}`, 'utf8')) : {};

  const precincts = [];
  const idIdx = new Map();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of gj.features) {
    const ds = f.properties.datasets || {};
    const id = String(f.properties.id);
    const pop = Math.round((ds.T_20_CENS?.Total) ?? (ds.T_20_ACS?.Total) ?? (ds.T_10_CENS?.Total) ?? 0);
    const v = {};
    let anyVotes = false;
    for (const y of PRES_YEARS) {
      const e = ds[`E_${String(y).slice(2)}_PRES`];
      if (e && (e.Dem || e.Rep)) { v[y] = [Math.round(e.Dem || 0), Math.round(e.Rep || 0)]; anyVotes = true; }
    }
    // A precinct with votes must NEVER be dropped for geometry reasons —
    // doing so silently biases the statewide total (tiny dense urban
    // precincts are disproportionately Democratic). Outer rings therefore
    // degrade gracefully: DP-simplified → quantized-only → a tiny square
    // at the precinct centroid. Holes may be dropped (no vote loss).
    if (!anyVotes) continue;
    const rawPolys = f.geometry.type === 'MultiPolygon'
      ? f.geometry.coordinates : [f.geometry.coordinates];
    const polys = [];
    for (const poly of rawPolys) {
      const rings = [];
      for (let ri = 0; ri < poly.length; ri++) {
        let pr = projectRing(poly[ri]);
        if (ri === 0 && (!pr || ringArea(pr) <= 0.0005)) pr = projectRing(poly[ri], true);
        if (ri === 0 ? pr : (pr && ringArea(pr) > 0.05)) rings.push(pr);
      }
      if (rings.length) polys.push(rings);
    }
    if (!polys.length) {
      // Geometry collapsed entirely — synthesize a sub-pixel footprint at
      // the precinct's projected centroid so its votes/pop still count.
      let sx = 0, sy = 0, c = 0;
      for (const [lon, lat] of (rawPolys[0]?.[0] || [])) {
        const p = proj([lon, lat]); if (p) { sx += p[0]; sy += p[1]; c++; }
      }
      if (!c) continue;
      const cx = q(sx / c), cy = q(sy / c), e = 0.03;
      polys.push([[[cx - e, cy - e], [cx + e, cy - e], [cx + e, cy + e], [cx - e, cy + e], [cx - e, cy - e]]]);
    }
    for (const rings of polys) for (const r of rings) for (const [x, y] of r) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    idIdx.set(id, precincts.length);
    precincts.push({ id, pop, v, polys });
  }

  // Adjacency from DRA's rook graph (drop OUT_OF_STATE + unknown ids).
  const adjacency = precincts.map(() => new Set());
  for (let i = 0; i < precincts.length; i++) {
    const nb = graph[precincts[i].id];
    if (!Array.isArray(nb)) continue;
    for (const nid of nb) {
      const j = idIdx.get(String(nid));
      if (j !== undefined && j !== i) { adjacency[i].add(j); adjacency[j].add(i); }
    }
  }
  // Connectivity fix (ReCom needs one connected graph) — bridge orphan
  // components / isolated nodes to nearest by precinct centroid.
  const cent = precincts.map((p) => {
    let sx = 0, sy = 0, n = 0;
    for (const [x, y] of p.polys[0][0]) { sx += x; sy += y; n++; }
    return [sx / n, sy / n];
  });
  const N = precincts.length;
  const comps = () => {
    const seen = new Uint8Array(N), cs = [];
    for (let i = 0; i < N; i++) {
      if (seen[i]) continue;
      const c = [i]; seen[i] = 1;
      for (let h = 0; h < c.length; h++) for (const w of adjacency[c[h]]) if (!seen[w]) { seen[w] = 1; c.push(w); }
      cs.push(c);
    }
    return cs;
  };
  let cs = comps().sort((a, b) => b.length - a.length);
  for (let ci = 1; ci < cs.length; ci++) {
    let bO = -1, bM = -1, bd = Infinity;
    for (const o of cs[ci]) for (const m of cs[0]) {
      const d = (cent[o][0] - cent[m][0]) ** 2 + (cent[o][1] - cent[m][1]) ** 2;
      if (d < bd) { bd = d; bO = o; bM = m; }
    }
    if (bO !== -1) { adjacency[bO].add(bM); adjacency[bM].add(bO); cs[0].push(...cs[ci]); }
  }

  const adjArr = adjacency.map((s) => [...s]);

  // ---- Pre-bake ReCom district assignments -----------------------------
  // Run the EXACT app algorithm offline so the national precinct view (and
  // default-seed state detail) render baked districts with zero in-browser
  // ReCom. Seed derivation + burnIn + tolerance mirror the app's
  // useStatePrecinctPartition precisely. Encoded base64 (1 byte/precinct,
  // 255 = unassigned) — the same format the app's b64ToAssignment reads.
  const seats = SEATS[st] || 1;
  const miniUnits = precincts.map((p) => ({ pop: p.pop }));
  const baked = {};
  if (seats > 1) {
    const N = precincts.length;
    const burnIn = Math.max(400, Math.min(2200, Math.round(N * 0.12)));
    const tgt = precincts.reduce((s, p) => s + p.pop, 0) / seats;
    for (const bs of BAKE_SEEDS) {
      const t0 = Date.now();
      const r = runReCom(miniUnits, adjArr, seats, stateSeed(bs, st),
        { burnIn, tolerance: 0.02 });
      if (!r) { console.log(`    bake seed ${bs}: FAILED`); continue; }
      let mx = 0;
      for (const dp of r.districtPop) {
        const dv = Math.abs(dp - tgt) / tgt; if (dv > mx) mx = dv;
      }
      const bytes = Buffer.alloc(N);
      for (let i = 0; i < N; i++) {
        const d = r.assignment[i];
        bytes[i] = d < 0 || d > 254 ? 255 : d;
      }
      baked[bs] = { a: bytes.toString('base64'), maxDev: +mx.toFixed(4) };
      console.log(`    bake seed ${bs}: maxDev ${(mx * 100).toFixed(1)}% ` +
        `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
  } else {
    // Single-district state: trivial assignment.
    const bytes = Buffer.alloc(precincts.length, 0);
    for (const bs of BAKE_SEEDS) baked[bs] = { a: bytes.toString('base64'), maxDev: 0 };
  }

  const out = {
    stateCode: st, fips, years: PRES_YEARS, seats,
    bbox: [minX, minY, maxX, maxY].map((x) => +x.toFixed(2)),
    n: precincts.length,
    precincts: precincts.map((p) => ({ id: p.id, pop: p.pop, v: p.v, polys: p.polys })),
    adjacency: adjArr,
    baked,
  };
  mkdirSync(OUT, { recursive: true });
  const path = `${OUT}/${fips}.json`;
  writeFileSync(path, JSON.stringify(out));
  const kb = (readFileSync(path).length / 1024).toFixed(0);
  let td = 0, tr = 0;
  for (const p of precincts) { if (p.v[2020]) { td += p.v[2020][0]; tr += p.v[2020][1]; } }
  console.log(`  ${st} (${fips}): ${precincts.length} precincts, ${kb} KB, ` +
    `2020 D ${(100 * td / (td + tr)).toFixed(1)}%  components→1`);
}

const states = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_STATES;
console.log(`Building precinct substrate for: ${states.join(' ')}`);
for (const st of states) {
  try { buildState(st); }
  catch (e) { console.log(`  ${st}: FAILED ${e.message}`); }
}
if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
console.log('done →', OUT);
