/**
 * add-splitline-national.mjs — branch-only (explore/precinct-data).
 *
 * The national PRECINCT view renders pre-dissolved district polygons from
 * public/data/precincts/<fips>-districts.json. build-precincts.mjs only
 * bakes ReCom (seeds 42/7/1337), so with the Splitline model selected the
 * national precinct map showed ReCom while the state-detail precinct view
 * ran Splitline live — a visible mismatch.
 *
 * Splitline is DETERMINISTIC (no seed), so it needs exactly ONE dissolve
 * per state. This is a fast ATTRIBUTE-MERGE (like add-demographics.mjs):
 * it reads the already-built <fips>.json, runs the SAME runSplitline the
 * app uses (scripts/lib/partition.mjs, kept in sync with Dashboard.jsx),
 * dissolves precinct→district polygons with the SAME mapshaper command
 * build-precincts.mjs uses, and writes a `splitline` block into the
 * existing <fips>-districts.json. No DRA download, no re-bake of ReCom.
 *
 * Usage: node scripts/add-splitline-national.mjs           (all built states)
 *        node scripts/add-splitline-national.mjs MI NC      (subset by USPS)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import mapshaper from 'mapshaper';
import { runSplitline } from './lib/partition.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const DIR = ROOT + 'public/data/precincts';

// Area-weighted multi-polygon centroid — identical to Dashboard.jsx's
// multiPolygonCentroid, so the offline Splitline matches the app's.
function multiPolygonCentroid(polys) {
  let totA = 0, cx = 0, cy = 0;
  for (const poly of polys) {
    for (const ring of poly) {
      let a = 0, x = 0, y = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % ring.length];
        const cross = x1 * y2 - x2 * y1;
        a += cross; x += (x1 + x2) * cross; y += (y1 + y2) * cross;
      }
      a /= 2;
      const absA = Math.abs(a);
      if (absA > 1e-9) { x /= 6 * a; y /= 6 * a; totA += absA; cx += x * absA; cy += y * absA; }
    }
  }
  return totA > 0 ? [cx / totA, cy / totA] : [0, 0];
}

const want = process.argv.slice(2);
const files = readdirSync(DIR).filter((f) => /^\d+\.json$/.test(f)).sort();

for (const f of files) {
  const pjPath = `${DIR}/${f}`;
  const pj = JSON.parse(readFileSync(pjPath, 'utf8'));
  const st = pj.stateCode;
  if (want.length && !want.includes(st)) continue;
  const fips = pj.fips || f.replace('.json', '');
  const distPath = `${DIR}/${fips}-districts.json`;
  let distOut;
  try { distOut = JSON.parse(readFileSync(distPath, 'utf8')); }
  catch { console.log(`  ${st}: no ${fips}-districts.json — skip`); continue; }

  const P = pj.precincts;
  const seats = pj.seats || 1;
  const years = pj.years || distOut.years || [2008, 2012, 2016, 2020];

  let assignment;
  if (seats > 1) {
    const units = P.map((p) => ({
      pop: p.pop || 0,
      centroid: multiPolygonCentroid(p.polys || []),
      polygons: p.polys || [],
    }));
    const adjacency = pj.adjacency;
    const res = runSplitline(units, adjacency, seats);
    assignment = res.assignment;
  } else {
    assignment = new Int16Array(P.length); // single-seat → all district 0
  }

  // Max population deviation of the splitline partition (reported, like
  // the ReCom bakes carry maxDev).
  const dpop = new Array(seats).fill(0);
  let tot = 0;
  for (let i = 0; i < P.length; i++) {
    const d = assignment[i]; if (d < 0) continue;
    dpop[d] += P[i].pop || 0; tot += P[i].pop || 0;
  }
  const tgt = tot / seats;
  let maxDev = 0;
  for (const dp of dpop) { const dv = Math.abs(dp - tgt) / (tgt || 1); if (dv > maxDev) maxDev = dv; }

  // Dissolve precinct geometry → district polygons + per-year votes,
  // byte-identical pipeline to build-precincts.mjs's ReCom dissolve.
  const feats = [];
  const dv = {};
  for (let i = 0; i < P.length; i++) {
    const d = assignment[i]; if (d < 0) continue;
    feats.push({ type: 'Feature', properties: { d },
      geometry: { type: 'MultiPolygon', coordinates: P[i].polys } });
    const pv = P[i].v || {};
    (dv[d] ||= {});
    for (const y of years) {
      const e = pv[y]; if (!e) continue;
      (dv[d][y] ||= [0, 0]); dv[d][y][0] += e[0]; dv[d][y][1] += e[1];
    }
  }
  const dgeo = {};
  try {
    const dres = await mapshaper.applyCommands(
      '-i d.json -dissolve2 d -o o.json format=geojson',
      { 'd.json': JSON.stringify({ type: 'FeatureCollection', features: feats }) });
    const fc = JSON.parse(dres['o.json'] || dres[Object.keys(dres)[0]]);
    for (const ft of fc.features || []) {
      const g = ft.geometry; if (!g) continue;
      dgeo[ft.properties.d] = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    }
  } catch (e) { console.log(`  ${st}: dissolve FAILED ${e.message}`); continue; }

  const dists = [];
  for (let d = 0; d < seats; d++) dists.push({ polys: dgeo[d] || [], v: dv[d] || {} });

  distOut.splitline = { maxDev: +maxDev.toFixed(4), dists };
  writeFileSync(distPath, JSON.stringify(distOut));
  console.log(`  ${st} (${fips}): splitline ${seats} seats, maxDev ${(maxDev * 100).toFixed(1)}%, ` +
    `${dists.filter((d) => d.polys.length).length}/${seats} polys`);
}
console.log('splitline national dissolve merged →', DIR);
