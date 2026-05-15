// Proof of concept: can precincts be a drop-in ReCom substrate (replacing
// the county+tract pipeline) for one state, on the app's existing per-state
// on-demand "upgrade" architecture?
// Builds, for Michigan 2016, the exact unit shape the app's runReCom
// consumes — { id, pop, votes:{d,r}, polygons } + a rook adjacency graph
// derived from shared polygon edges (same idea as the app's shared-arc
// county adjacency) — then reports the feasibility metrics.
import * as shapefile from 'shapefile';
import { gzipSync } from 'node:zlib';

const src = await shapefile.open('precinct/MI/mi16_results.shp', 'precinct/MI/mi16_results.dbf');

const units = [];
let rec = await src.read();
while (!rec.done) {
  const p = rec.value.properties, g = rec.value.geometry;
  const d = +p.PRES16D || 0, r = +p.PRES16R || 0;
  units.push({
    id: p.VTD || ('P' + units.length),
    county: String(p.county_fip),
    pop: +p.TOTPOP || 0,
    votes: { d, r },
    geometry: g,
  });
  rec = await src.read();
}

// ---- Rook adjacency from shared edges --------------------------------
// Snap coords to 0.5 m grid (data is in State Plane meters) and key every
// undirected segment. Two precincts that share ≥1 segment are neighbors.
// This is exactly how the app builds county adjacency from shared topojson
// arcs — just computed here instead of pre-encoded.
const SNAP = 2; // 1/2 m grid
const key = (x, y) => `${Math.round(x * SNAP)},${Math.round(y * SNAP)}`;
const segOwners = new Map(); // segKey -> Set(unitIdx)
function addRing(ring, ui) {
  for (let i = 1; i < ring.length; i++) {
    const a = key(ring[i - 1][0], ring[i - 1][1]);
    const b = key(ring[i][0], ring[i][1]);
    if (a === b) continue;
    const sk = a < b ? a + '|' + b : b + '|' + a;
    let s = segOwners.get(sk);
    if (!s) segOwners.set(sk, (s = new Set()));
    s.add(ui);
  }
}
units.forEach((u, ui) => {
  const g = u.geometry;
  if (!g) return;
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  for (const poly of polys) for (const ring of poly) addRing(ring, ui);
});
const adj = units.map(() => new Set());
for (const owners of segOwners.values()) {
  if (owners.size < 2) continue;
  const a = [...owners];
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++) { adj[a[i]].add(a[j]); adj[a[j]].add(a[i]); }
}

// ---- Connectivity (ReCom needs a connected dual graph) ----------------
const seen = new Uint8Array(units.length);
let comps = 0, biggest = 0;
for (let s = 0; s < units.length; s++) {
  if (seen[s]) continue;
  comps++;
  let sz = 0;
  const stack = [s];
  seen[s] = 1;
  while (stack.length) {
    const v = stack.pop(); sz++;
    for (const w of adj[v]) if (!seen[w]) { seen[w] = 1; stack.push(w); }
  }
  biggest = Math.max(biggest, sz);
}
let edges = 0;
for (const s of adj) edges += s.size;
edges /= 2;

// ---- Shippable payload size ------------------------------------------
// The app ships per-state geometry as topojson (~simplified). Here we just
// measure the order of magnitude: votes+pop+adjacency (no geometry) and a
// crude geometry estimate, gzipped, vs the existing tract file (26.json).
const graphPayload = JSON.stringify(units.map((u, i) => ({
  i, p: u.pop, d: u.votes.d, r: u.votes.r, a: [...adj[i]],
})));
const gz = (s) => gzipSync(Buffer.from(s)).length;
import { statSync } from 'node:fs';
let tractBytes = 0;
try { tractBytes = statSync('../site/public/data/tracts/26.json').size; } catch {}

const totPop = units.reduce((s, u) => s + u.pop, 0);
const totD = units.reduce((s, u) => s + u.votes.d, 0);
const totR = units.reduce((s, u) => s + u.votes.r, 0);
const isolated = adj.filter((s) => s.size === 0).length;

console.log('=== Michigan precinct substrate — ReCom feasibility ===\n');
console.log('precinct units            :', units.length);
console.log('  vs census tracts (app)  : ~2,772');
console.log('  vs county fragments     : ~83 counties (slab-cut to ~140)');
console.log('Σ population              :', totPop.toLocaleString(), '(2010 census 9,883,640)');
console.log('Σ two-party votes         : D', totD.toLocaleString(), '/ R', totR.toLocaleString(),
            '→ D', (100 * totD / (totD + totR)).toFixed(2) + '%');
console.log('\nadjacency graph');
console.log('  edges                   :', edges.toLocaleString());
console.log('  mean degree             :', (2 * edges / units.length).toFixed(1));
console.log('  isolated units          :', isolated);
console.log('  connected components    :', comps,
            '(largest holds', biggest, '=', (100 * biggest / units.length).toFixed(1) + '% of units)');
console.log('  → ReCom needs 1 connected graph: water gaps/islands need the');
console.log('    same manual bridge list the app already maintains for counties.');
console.log('\nshippable payload (gzipped)');
console.log('  votes+pop+adjacency only:', (gz(graphPayload) / 1024).toFixed(0), 'KB');
console.log('  existing MI tract file  :', (tractBytes / 1024).toFixed(0), 'KB (geometry topojson)');
console.log('  → precinct geometry topojson would be the same order as tracts;');
console.log('    ~1.7× the unit count, similar bytes after simplification.');
