// AUTO-EXTRACTED from components/Dashboard.jsx (partitioner block) via
// scripts/_extract_partition.mjs — verbatim except `export` added and
// runReCom imported from recom.mjs. KEEP IN SYNC: re-run that script if
// the partitioner block in Dashboard.jsx changes.

import { runReCom } from './recom.mjs';

export function polyAreaOf(polys) {
  let A = 0;
  for (const poly of polys || []) {
    for (let r = 0; r < poly.length; r++) {
      const ring = poly[r];
      let a = 0;
      for (let i = 0, m = ring.length, j = m - 1; i < m; j = i++)
        a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      A += (r === 0 ? 1 : -1) * Math.abs(a / 2);
    }
  }
  return A;
}
// BFS: is district `dist` still connected if unit `drop` is removed?
export function stillConnected(adjacency, assignment, dist, drop) {
  let start = -1, count = 0;
  for (let i = 0; i < assignment.length; i++) {
    if (assignment[i] === dist && i !== drop) { count++; if (start < 0) start = i; }
  }
  if (count === 0) return true;
  const seen = new Uint8Array(assignment.length);
  const st = [start]; seen[start] = 1; let vis = 1;
  while (st.length) {
    const u = st.pop();
    for (const v of adjacency[u]) {
      if (v !== drop && assignment[v] === dist && !seen[v]) { seen[v] = 1; vis++; st.push(v); }
    }
  }
  return vis === count;
}
// Greedy contiguity-preserving population rebalance: move boundary units
// from the most over-target district to an adjacent under-target one while
// both stay connected. Deterministic, bounded.
export function rebalance(units, adjacency, assignment, districtPop, k, tol = 0.03) {
  const total = districtPop.reduce((s, p) => s + p, 0);
  const target = total / k;
  const maxMoves = Math.min(units.length * 4, 60000);
  for (let mv = 0; mv < maxMoves; mv++) {
    let hi = -1, hiDev = 0;
    for (let d = 0; d < k; d++) {
      const dev = (districtPop[d] - target) / target;
      if (dev > hiDev) { hiDev = dev; hi = d; }
    }
    if (hi < 0 || hiDev <= tol) break;
    // Find a boundary unit of `hi` adjacent to a lower-pop district whose
    // move improves balance and keeps `hi` connected.
    let bestU = -1, bestTo = -1, bestGain = 0;
    for (let i = 0; i < units.length; i++) {
      if (assignment[i] !== hi) continue;
      for (const v of adjacency[i]) {
        const to = assignment[v];
        if (to === hi || to < 0) continue;
        if (districtPop[to] >= districtPop[hi] - units[i].pop) continue;
        const before = Math.abs(districtPop[hi] - target) + Math.abs(districtPop[to] - target);
        const after = Math.abs(districtPop[hi] - units[i].pop - target) +
                      Math.abs(districtPop[to] + units[i].pop - target);
        const gain = before - after;
        if (gain > bestGain) { bestGain = gain; bestU = i; bestTo = to; }
      }
    }
    if (bestU < 0) break;
    if (!stillConnected(adjacency, assignment, hi, bestU)) {
      // Skip this unit permanently this pass by nudging: try next iteration
      // it'll be re-found; to avoid infinite loop, zero its candidacy by
      // moving on if no other improving move exists.
      let moved = false;
      for (let i = 0; i < units.length && !moved; i++) {
        if (assignment[i] !== hi) continue;
        for (const v of adjacency[i]) {
          const to = assignment[v];
          if (to === hi || to < 0) continue;
          if (districtPop[to] >= districtPop[hi] - units[i].pop) continue;
          if (!stillConnected(adjacency, assignment, hi, i)) continue;
          assignment[i] = to; districtPop[hi] -= units[i].pop; districtPop[to] += units[i].pop;
          moved = true; break;
        }
      }
      if (!moved) break;
      continue;
    }
    assignment[bestU] = bestTo;
    districtPop[hi] -= units[bestU].pop;
    districtPop[bestTo] += units[bestU].pop;
  }
}

// Reassign only SMALL stray components (specks left by straight splitline
// cuts) to whichever adjacent district they touch most — large legitimate
// pieces are left alone so splitline keeps its exact equipopulation.
// Deterministic.
function enforceContiguity(units, adjacency, assignment, k, passes = 2) {
  const n = assignment.length;
  const maxStray = Math.max(2, Math.round(n * 0.0006));
  for (let pass = 0; pass < passes; pass++) {
    const comp = new Int32Array(n).fill(-1);
    let nc = 0; const compD = [], compSz = [];
    for (let s = 0; s < n; s++) {
      if (comp[s] >= 0) continue;
      const d = assignment[s], id = nc++; compD.push(d); let sz = 0;
      const st = [s]; comp[s] = id;
      while (st.length) { const u = st.pop(); sz++; for (const v of adjacency[u]) if (comp[v] < 0 && assignment[v] === d) { comp[v] = id; st.push(v); } }
      compSz.push(sz);
    }
    const biggest = {};
    for (let cId = 0; cId < nc; cId++) { const d = compD[cId]; if (!biggest[d] || compSz[cId] > biggest[d].sz) biggest[d] = { id: cId, sz: compSz[cId] }; }
    let changed = false;
    for (let i = 0; i < n; i++) {
      const d = assignment[i];
      if (!biggest[d] || comp[i] === biggest[d].id) continue;
      if (compSz[comp[i]] > maxStray) continue; // leave large legit pieces
      const tally = {};
      for (const v of adjacency[i]) if (assignment[v] !== d) tally[assignment[v]] = (tally[assignment[v]] || 0) + 1;
      let to = -1, mx = 0;
      for (const kk in tally) if (tally[kk] > mx) { mx = tally[kk]; to = +kk; }
      if (to >= 0) { assignment[i] = to; changed = true; }
    }
    if (!changed) break;
  }
}

export function runSeedGrow(units, adjacency, k) {
  const n = units.length;
  const assignment = new Int16Array(n).fill(-1);
  const districtPop = new Array(k).fill(0);
  if (k <= 1) {
    assignment.fill(0);
    districtPop[0] = units.reduce((s, u) => s + u.pop, 0);
    return { assignment, districtPop };
  }
  const total = units.reduce((s, u) => s + u.pop, 0);
  const quota = total / k;
  const cen = units.map((u) => u.centroid);
  const dens = new Float64Array(n);
  for (let i = 0; i < n; i++) dens[i] = (units[i].pop || 0) / (polyAreaOf(units[i].polygons) || 1e-9);

  // Sequential metro-anchored grow-to-quota. Each round, the next
  // district's seed is the densest still-UNASSIGNED unit — i.e. the core
  // of the largest remaining metro (once a metro's territory is consumed,
  // the densest remaining unit is in the next metro). The district annexes
  // the unassigned frontier unit NEAREST its seed (compact, roughly
  // circular outward growth) until it has captured a district's worth of
  // people; the final district mops up whatever is left. Deterministic.
  // Region-growing trades exact population parity for community-compact,
  // metro-centred districts and is inherently looser on parity than
  // ReCom/splitline — an honest, illustrative tradeoff. A contiguity-
  // preserving rebalance then trims toward parity where it can.
  for (let d = 0; d < k; d++) {
    if (d === k - 1) { // final district mops up the remainder
      for (let i = 0; i < n; i++) if (assignment[i] < 0) { assignment[i] = d; districtPop[d] += units[i].pop; }
      break;
    }
    let sd = -1, bestDen = -1;
    for (let i = 0; i < n; i++) if (assignment[i] < 0 && dens[i] > bestDen) { bestDen = dens[i]; sd = i; }
    if (sd < 0) break;
    const sx = cen[sd][0], sy = cen[sd][1];
    assignment[sd] = d; districtPop[d] += units[sd].pop;
    const inF = new Uint8Array(n);
    const frontier = [];
    for (const v of adjacency[sd]) if (assignment[v] < 0 && !inF[v]) { inF[v] = 1; frontier.push(v); }
    while (districtPop[d] < quota && frontier.length) {
      let bi = -1, bd2 = Infinity;
      for (let fi = 0; fi < frontier.length; fi++) {
        const u = frontier[fi];
        if (assignment[u] >= 0) continue;
        const dx = cen[u][0] - sx, dy = cen[u][1] - sy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bd2 || (d2 === bd2 && (bi < 0 || u < frontier[bi]))) { bd2 = d2; bi = fi; }
      }
      if (bi < 0) break;
      const u = frontier[bi];
      frontier[bi] = frontier[frontier.length - 1]; frontier.pop(); inF[u] = 0;
      if (assignment[u] >= 0) continue;
      assignment[u] = d; districtPop[d] += units[u].pop;
      for (const v of adjacency[u]) if (assignment[v] < 0 && !inF[v]) { inF[v] = 1; frontier.push(v); }
    }
  }
  for (let i = 0; i < n; i++) if (assignment[i] < 0) { assignment[i] = k - 1; districtPop[k - 1] += units[i].pop; }
  rebalance(units, adjacency, assignment, districtPop, k, 0.05);
  return { assignment, districtPop };
}

export function _convexHull(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  const up = [];
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
// Length of the chord cut from convex polygon `hull` by line n·x = c.
export function _chordLen(hull, nx, ny, c) {
  let lo = Infinity, hi = -Infinity, hits = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const da = nx * a[0] + ny * a[1] - c, db = nx * b[0] + ny * b[1] - c;
    if ((da <= 0 && db >= 0) || (da >= 0 && db <= 0)) {
      const t = da === db ? 0 : da / (da - db);
      const ix = a[0] + t * (b[0] - a[0]), iy = a[1] + t * (b[1] - a[1]);
      const s = -ny * ix + nx * iy; // coordinate ALONG the line
      if (s < lo) lo = s; if (s > hi) hi = s; hits++;
    }
  }
  return hits >= 2 && hi > lo ? hi - lo : Infinity;
}
export function runSplitline(units, adjacency, k) {
  const n = units.length;
  const assignment = new Int16Array(n).fill(0);
  if (k <= 1) return { assignment, districtPop: [units.reduce((s, u) => s + u.pop, 0)] };
  const ANGLES = 120;
  function recurse(members, K, did) {
    if (K <= 1) { for (const i of members) assignment[i] = did; return; }
    const A = Math.floor(K / 2), B = K - A;
    let popSum = 0;
    for (const i of members) popSum += units[i].pop;
    const targetA = popSum * (A / K);
    const hull = _convexHull(members.map((i) => units[i].centroid));
    let bestLen = Infinity, bestKey = null, bestSplit = null;
    for (let t = 0; t < ANGLES; t++) {
      const th = (Math.PI * t) / ANGLES;
      const nx = Math.cos(th), ny = Math.sin(th);
      const sorted = members
        .map((i) => ({ i, p: nx * units[i].centroid[0] + ny * units[i].centroid[1] }))
        .sort((a, b) => a.p - b.p);
      let acc = 0, j = 0;
      for (; j < sorted.length - 1; j++) {
        acc += units[sorted[j].i].pop;
        if (acc >= targetA) break;
      }
      // c = midpoint between the two straddling projections
      const c = (sorted[j].p + sorted[Math.min(j + 1, sorted.length - 1)].p) / 2;
      const len = _chordLen(hull, nx, ny, c);
      // tie keys: most North–South line (line dir = θ+90°; N–S = 90°),
      // then Westernmost (smaller cut x-intercept proxy = c*nx).
      const lineAng = ((th * 180) / Math.PI + 90) % 180;
      const nsDev = Math.abs(lineAng - 90);
      const west = c * nx;
      if (len < bestLen - 1e-6 ||
          (Math.abs(len - bestLen) <= 1e-6 && bestKey &&
           (nsDev < bestKey.nsDev - 1e-6 ||
            (Math.abs(nsDev - bestKey.nsDev) <= 1e-6 && west < bestKey.west)))) {
        bestLen = len;
        bestKey = { nsDev, west };
        bestSplit = sorted.map((s) => s.i).slice();
        bestSplit._j = j;
      }
    }
    if (!bestSplit) { // degenerate — fall back to even index split
      const ord = members.slice();
      const aSide = ord.slice(0, Math.round(members.length * (A / K)));
      const bSide = ord.slice(aSide.length);
      recurse(aSide, A, did); recurse(bSide, B, did + A); return;
    }
    const aSide = bestSplit.slice(0, bestSplit._j + 1);
    const bSide = bestSplit.slice(bestSplit._j + 1);
    recurse(aSide, A, did);
    recurse(bSide, B, did + A);
  }
  recurse(units.map((_, i) => i), k, 0);
  enforceContiguity(units, adjacency, assignment, k);
  const districtPop = new Array(k).fill(0);
  for (let i = 0; i < n; i++) districtPop[assignment[i]] += units[i].pop;
  return { assignment, districtPop };
}

// Single entry point the app + pipeline route every districting through.
export function runPartition(model, units, adjacency, k, seed, opts = {}) {
  if (model === 'seedgrow') return runSeedGrow(units, adjacency, k);
  if (model === 'splitline') return runSplitline(units, adjacency, k);
  return runReCom(units, adjacency, k, seed, opts);
}
