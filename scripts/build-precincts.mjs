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
import mapshaper from 'mapshaper';
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
// mapshaper Visvalingam simplify retention (% of vertices kept). Applied
// to the SHARED-ARC topology, so precinct borders stay coincident.
const SIMPLIFY_PCT = 14;
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
// All 50 states. Single-seat states (AK/DE/ND/SD/VT/WY) still get real
// precinct geometry + returns for the map; their one "district" is trivial.
const DEFAULT_STATES = Object.keys(FIPS);

const proj = geoAlbersUsa().scale(1300).translate([487.5, 305]);

const q = (v) => Math.round(v * QUANT) / QUANT;

function ringArea(r) {
  let a = 0;
  for (let i = 0, n = r.length, j = n - 1; i < n; j = i++)
    a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return Math.abs(a / 2);
}

async function buildState(st) {
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

  // ---- Pass 1: parse attrs + project geometry (NO simplification) ------
  // Build a projected GeoJSON FeatureCollection that mapshaper will
  // simplify TOPOLOGICALLY — i.e. it builds shared arcs first, simplifies
  // those, so a border between two precincts stays a single shared edge.
  // (Per-ring simplification, which this replaces, made the two sides
  // diverge → the district tracer couldn't cancel interior edges → the
  // black-mesh artifact.)
  const meta = new Map();      // id → { pop, v }
  const cxy = new Map();       // id → projected centroid (collapse fallback)
  const inFeatures = [];
  for (const f of gj.features) {
    const ds = f.properties.datasets || {};
    const id = String(f.properties.id);
    const pop = Math.round((ds.T_20_CENS?.Total) ?? (ds.T_20_ACS?.Total) ?? (ds.T_10_CENS?.Total) ?? 0);
    // 2020-census demographics (P.L. 94-171): race totals + voting-age
    // population. dm = [White, Black, Hispanic, Asian, Native, Pacific,
    // VAP_total]. (DRA's vtd_data has no gender/age-bracket fields — only
    // total vs voting-age; that's the demographic ceiling of this source.)
    const C = ds.T_20_CENS || {}, VAP = ds.V_20_VAP || {};
    const dm = [C.White, C.Black, C.Hispanic, C.Asian, C.Native, C.Pacific, VAP.Total]
      .map((x) => Math.round(x || 0));
    const v = {};
    let anyVotes = false;
    for (const y of PRES_YEARS) {
      const e = ds[`E_${String(y).slice(2)}_PRES`];
      if (e && (e.Dem || e.Rep)) { v[y] = [Math.round(e.Dem || 0), Math.round(e.Rep || 0)]; anyVotes = true; }
    }
    void anyVotes; // keep EVERY precinct as a unit — even zero-vote ones
    // carry population and (critically) are stepping-stones in the DRA
    // adjacency graph; dropping them fragmented the graph and forced long
    // bogus centroid bridges → the "inland island" artifact.
    const rawPolys = f.geometry.type === 'MultiPolygon'
      ? f.geometry.coordinates : [f.geometry.coordinates];
    const outPolys = [];
    let sx = 0, sy = 0, sc = 0;
    for (const poly of rawPolys) {
      const rings = [];
      for (const ring of poly) {
        const pr = [];
        for (const [lon, lat] of ring) {
          const p = proj([lon, lat]);
          if (p) { pr.push([p[0], p[1]]); sx += p[0]; sy += p[1]; sc++; }
        }
        if (pr.length >= 4) rings.push(pr);
      }
      if (rings.length) outPolys.push(rings);
    }
    meta.set(id, { pop, v, dm });
    if (sc) cxy.set(id, [sx / sc, sy / sc]);
    if (outPolys.length) {
      inFeatures.push({
        type: 'Feature', properties: { id },
        geometry: { type: 'MultiPolygon', coordinates: outPolys },
      });
    }
  }

  // ---- Topology-aware simplify (mapshaper) ----------------------------
  // `snap` on import merges coincident vertices → a proper shared-arc
  // topology; `-simplify keep-shapes` then thins those SHARED arcs, so a
  // border between two precincts stays one identical edge (what makes the
  // district tracer cancel interior edges → clean outlines). `-clean` is
  // deliberately omitted: it does full overlap/sliver repair (O(n²)-ish
  // intersection work that dominated runtime — ~3 min on small states,
  // far worse on CA/NY) and is unnecessary here, since correctness only
  // needs shared edges to coincide, which `snap`+topology-simplify already
  // guarantees. Verified: boundary-edge fraction stays ≈10%.
  const fc = JSON.stringify({ type: 'FeatureCollection', features: inFeatures });
  const cmd = `-i in.json snap -simplify ${SIMPLIFY_PCT}% keep-shapes planar ` +
              `-o out.json format=geojson`;
  const res = await mapshaper.applyCommands(cmd, { 'in.json': fc });
  const simplified = JSON.parse(res['out.json'] || res[Object.keys(res)[0]]);

  // ---- Pass 2: quantize + assemble (shared edges now coincide) --------
  const precincts = [];
  const idIdx = new Map();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const quantRing = (ring) => {
    const r = [];
    for (const [x, y] of ring) {
      const qx = q(x), qy = q(y);
      if (!r.length || qx !== r[r.length - 1][0] || qy !== r[r.length - 1][1]) r.push([qx, qy]);
    }
    if (r.length >= 4 &&
        (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push(r[0]);
    return r.length >= 4 ? r : null;
  };
  const seen = new Set();
  for (const f of simplified.features || []) {
    const id = String(f.properties.id);
    const m = meta.get(id);
    if (!m || seen.has(id)) continue;
    seen.add(id);
    const g = f.geometry;
    const raw = !g ? [] : g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    const polys = [];
    for (const poly of raw) {
      const rings = [];
      for (let ri = 0; ri < poly.length; ri++) {
        const qr = quantRing(poly[ri]);
        if (ri === 0 ? qr : (qr && ringArea(qr) > 0.04)) rings.push(qr);
      }
      if (rings.length && rings[0]) polys.push(rings);
    }
    if (!polys.length) {
      const c = cxy.get(id); if (!c) continue;       // no-drop guarantee
      const cx = q(c[0]), cy = q(c[1]), e = 0.03;
      polys.push([[[cx - e, cy - e], [cx + e, cy - e], [cx + e, cy + e], [cx - e, cy + e], [cx - e, cy - e]]]);
    }
    for (const rings of polys) for (const r of rings) for (const [x, y] of r) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    idIdx.set(id, precincts.length);
    precincts.push({ id, pop: m.pop, v: m.v, dm: m.dm, polys });
  }
  // No-drop safety: any voted precinct mapshaper dropped → centroid square.
  for (const [id, m] of meta) {
    if (idIdx.has(id)) continue;
    const c = cxy.get(id); if (!c) continue;
    const cx = q(c[0]), cy = q(c[1]), e = 0.03;
    idIdx.set(id, precincts.length);
    precincts.push({ id, pop: m.pop, v: m.v, dm: m.dm,
      polys: [[[[cx - e, cy - e], [cx + e, cy - e], [cx + e, cy + e], [cx - e, cy + e], [cx - e, cy - e]]]] });
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
  const nComp = cs.length;
  let maxBridge = 0;
  for (let ci = 1; ci < cs.length; ci++) {
    let bO = -1, bM = -1, bd = Infinity;
    for (const o of cs[ci]) for (const m of cs[0]) {
      const d = (cent[o][0] - cent[m][0]) ** 2 + (cent[o][1] - cent[m][1]) ** 2;
      if (d < bd) { bd = d; bO = o; bM = m; }
    }
    if (bO !== -1) {
      adjacency[bO].add(bM); adjacency[bM].add(bO); cs[0].push(...cs[ci]);
      maxBridge = Math.max(maxBridge, Math.sqrt(bd));
    }
  }
  // With every DRA precinct kept 1:1, the DRA graph (a single component)
  // is preserved → this should report "components 1, no bridges". Any
  // bridging here means precincts were still lost somewhere.
  const bridgeNote = nComp === 1
    ? 'graph 1-component ✓'
    : `BRIDGED ${nComp - 1} gap(s), max ${maxBridge.toFixed(1)}u`;

  const adjArr = adjacency.map((s) => [...s]);

  // ---- Pre-bake ReCom district assignments -----------------------------
  // Run the EXACT app algorithm offline so the national precinct view (and
  // default-seed state detail) render baked districts with zero in-browser
  // ReCom. Seed derivation + burnIn + tolerance mirror the app's
  // useStatePrecinctPartition precisely. Encoded base64 (1 byte/precinct,
  // 255 = unassigned) — the same format the app's b64ToAssignment reads.
  const seats = SEATS[st] || 1;
  const miniUnits = precincts.map((p) => ({ pop: p.pop }));
  // County FIPS (first 5 of the VTD GEOID) → the cohesion group so the
  // bake also resists gratuitously slicing counties/metros across seats.
  const cohesion = precincts.map((p) => String(p.id).slice(0, 5));
  const baked = {};
  if (seats > 1) {
    const N = precincts.length;
    const burnIn = Math.max(400, Math.min(2200, Math.round(N * 0.12)));
    const tgt = precincts.reduce((s, p) => s + p.pop, 0) / seats;
    const devOf = (r) => {
      let mx = 0;
      for (const dp of r.districtPop) {
        const dv = Math.abs(dp - tgt) / tgt; if (dv > mx) mx = dv;
      }
      return mx;
    };
    for (const bs of BAKE_SEEDS) {
      const t0 = Date.now();
      // Compactness ladder: try a STRICT graph-isoperimetric threshold
      // first (favors round, contiguous districts — the "compact feeling"),
      // relax only if it can't hit the ±5 % legal bound. Keep the first
      // attempt that's legal, else the lowest-deviation one. This is what
      // makes the rendered precinct districts read as clean blocks rather
      // than the scribbly tendrils a single loose run produced in metros.
      let best = null, bestDev = Infinity, usedC = null;
      for (const c of [0.9, 1.4, 2.2]) {
        const r = runReCom(miniUnits, adjArr, seats, stateSeed(bs, st),
          { burnIn, tolerance: 0.02, compactness: c, cohesion });
        if (!r) continue;
        const dev = devOf(r);
        if (dev < bestDev) { best = r; bestDev = dev; usedC = c; }
        if (dev <= 0.05) break; // legal + compact-as-possible — take it
      }
      if (!best) { console.log(`    bake seed ${bs}: FAILED`); continue; }
      const bytes = Buffer.alloc(N);
      for (let i = 0; i < N; i++) {
        const d = best.assignment[i];
        bytes[i] = d < 0 || d > 254 ? 255 : d;
      }
      baked[bs] = { a: bytes.toString('base64'), maxDev: +bestDev.toFixed(4) };
      console.log(`    bake seed ${bs}: maxDev ${(bestDev * 100).toFixed(1)}% ` +
        `c=${usedC} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
  } else {
    // Single-district state: trivial assignment.
    const bytes = Buffer.alloc(precincts.length, 0);
    for (const bs of BAKE_SEEDS) baked[bs] = { a: bytes.toString('base64'), maxDev: 0 };
  }

  // ---- Dissolve precincts → district polygons (per baked seed) ---------
  // The national view must NOT build 50 states of precinct geometry in the
  // browser (~71 MB, ~180k paths — unusable). Instead we dissolve precincts
  // into their ~k district polygons offline (mapshaper, topology-aware) and
  // ship a tiny per-state district file the national view renders directly
  // (~435 polygons nationwide). Full precinct geometry is fetched only when
  // a single state's detail view is opened.
  const distOut = { fips, stateCode: st, seats, years: PRES_YEARS, baked: {} };
  for (const bs of BAKE_SEEDS) {
    if (!baked[bs]) continue;
    const asn = [...Buffer.from(baked[bs].a, 'base64')].map((b) => (b === 255 ? -1 : b));
    const feats = [];
    const dv = {}; // district → year → [d, r]
    for (let i = 0; i < precincts.length; i++) {
      const d = asn[i]; if (d < 0) continue;
      feats.push({ type: 'Feature', properties: { d },
        geometry: { type: 'MultiPolygon', coordinates: precincts[i].polys } });
      const pv = precincts[i].v || {};
      (dv[d] ||= {});
      for (const y of PRES_YEARS) {
        const e = pv[y]; if (!e) continue;
        (dv[d][y] ||= [0, 0]); dv[d][y][0] += e[0]; dv[d][y][1] += e[1];
      }
    }
    let dgeo = {};
    try {
      const dres = await mapshaper.applyCommands(
        '-i d.json -dissolve2 d -o o.json format=geojson',
        { 'd.json': JSON.stringify({ type: 'FeatureCollection', features: feats }) });
      const fc = JSON.parse(dres['o.json'] || dres[Object.keys(dres)[0]]);
      for (const f of fc.features || []) {
        const g = f.geometry; if (!g) continue;
        dgeo[f.properties.d] = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
      }
    } catch (e) { console.log(`    dissolve seed ${bs}: ${e.message}`); }
    const dists = [];
    for (let d = 0; d < seats; d++) {
      dists.push({ polys: dgeo[d] || [], v: dv[d] || {} });
    }
    distOut.baked[bs] = { maxDev: baked[bs].maxDev, dists };
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${fips}-districts.json`, JSON.stringify(distOut));

  const out = {
    stateCode: st, fips, years: PRES_YEARS, seats,
    bbox: [minX, minY, maxX, maxY].map((x) => +x.toFixed(2)),
    n: precincts.length,
    precincts: precincts.map((p) => ({ id: p.id, pop: p.pop, v: p.v, dm: p.dm, polys: p.polys })),
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
    `2020 D ${(100 * td / (td + tr)).toFixed(1)}%  ${bridgeNote}`);
}

const states = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_STATES;
console.log(`Building precinct substrate for: ${states.join(' ')}`);
for (const st of states) {
  try { await buildState(st); }
  catch (e) { console.log(`  ${st}: FAILED ${e.message}`); }
}
if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
console.log('done →', OUT);
