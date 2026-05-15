// AUTO-EXTRACTED from components/Dashboard.jsx (lines 1698-2464), verbatim
// except `export` added to the 5 entry points. Pure ReCom — no React/DOM.
// Used by scripts/build-precincts.mjs to PRE-BAKE precinct district
// assignments with the EXACT algorithm the app runs in-browser, so the
// national precinct view renders baked districts instantly.
// KEEP IN SYNC: if the ReCom block in Dashboard.jsx changes, re-extract
// via: node scripts/_extract_recom.mjs

/* ---------- DETERMINISTIC PRNG ------------------------------------------ */
// Mulberry32: small fast 32-bit PRNG with adequate distribution properties
// for Monte Carlo work. Same seed → same chain, which is the whole point
// for reproducibility ("publish the seed, anyone can verify the map").
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* =============================================================================
   RECOM — RECOMBINATION MARKOV CHAIN
   --------------------------------------------------------------------------
   Per state, builds k congressional districts as a balanced k-partition of
   the unit adjacency graph. Algorithm of DeFord–Duchin–Solomon (2021):

     (1) Start from any valid partition (k contiguous components, populations
         within ±tolerance of state_pop/k).
     (2) Pick two adjacent districts at random (i.e., a pair where some unit
         in district A is graph-adjacent to some unit in district B).
     (3) Take the union of those two districts as a subgraph H.
     (4) Sample a uniform random spanning tree T of H using Wilson's algorithm.
     (5) Find an edge e in T whose removal partitions T into two subtrees
         whose populations are both within tolerance of state_pop/k. If
         multiple such edges exist, pick uniformly. If none exist, reject.
     (6) On accept: replace the two districts with the two subtree halves.
     (7) Repeat for many steps. The chain is ergodic on the space of
         contiguous balanced partitions and (empirically) mixes quickly.

   Properties:
   - Every step preserves contiguity (subtrees of a connected graph are
     connected).
   - Every accepted step preserves population balance.
   - Districts emerge compact because spanning trees prefer short edges
     (no compactness penalty needed).
   ============================================================================ */

// Wilson's loop-erased random walk: produces a uniform random spanning tree
// of an undirected graph. Returns the parent map keyed by node index, where
// parent[root] = -1.
//
// Implementation: pick an arbitrary root r. For each non-root node u (in
// some order), do a random walk from u until it hits the existing tree;
// erase loops along the way; add the loop-erased path to the tree.
export function uniformSpanningTree(nodes, adjacency, rng) {
  const n = nodes.length;
  if (n === 0) return null;
  if (n === 1) return { parent: new Map([[nodes[0], -1]]), root: nodes[0] };
  const nodeSet = new Set(nodes);
  const parent = new Map();
  const inTree = new Set();
  const root = nodes[0];
  inTree.add(root);
  parent.set(root, -1);
  // Process other nodes in shuffled order (Wilson is invariant to order
  // but shuffling avoids any pathological adjacency layouts).
  const order = nodes.slice(1);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const start of order) {
    if (inTree.has(start)) continue;
    // Random walk from start until we hit the tree, tracking next-pointer
    // for each visited node so we can backtrack erasing loops.
    const next = new Map();
    let cur = start;
    while (!inTree.has(cur)) {
      const nbrs = adjacency[cur];
      // Filter to neighbors in this subgraph
      const valid = [];
      for (const v of nbrs) if (nodeSet.has(v)) valid.push(v);
      if (valid.length === 0) {
        // Shouldn't happen if subgraph is connected
        return null;
      }
      const pick = valid[Math.floor(rng() * valid.length)];
      next.set(cur, pick);
      cur = pick;
    }
    // Walk from start following next-pointers (loops auto-erased: we just
    // follow whatever next.get points to now), adding each node to the tree.
    let u = start;
    while (!inTree.has(u)) {
      const v = next.get(u);
      parent.set(u, v);
      inTree.add(u);
      u = v;
    }
  }
  return { parent, root };
}

// Given a tree (parent map) and population per node, find the set of edges
// whose removal produces two pieces both within tolerance. Returns array of
// candidate cut edges as {child, parent, leftPop, rightPop, leftNodes}.
//
// Tree DP: for each node, compute the total population of the subtree rooted
// there. The edge from a node to its parent, if cut, gives subtree pop
// (one side) and totalPop - subtreePop (other side).
function findBalancedCuts(tree, populations, target, tolerance) {
  const { parent, root } = tree;
  const nodes = [...parent.keys()];
  const childrenMap = new Map();
  for (const u of nodes) childrenMap.set(u, []);
  for (const u of nodes) {
    const p = parent.get(u);
    if (p !== -1) childrenMap.get(p).push(u);
  }
  // Post-order: compute subtree populations
  const subtreePop = new Map();
  const order = [];
  const stack = [{ u: root, expanded: false }];
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (!top.expanded) {
      top.expanded = true;
      for (const c of childrenMap.get(top.u)) stack.push({ u: c, expanded: false });
    } else {
      stack.pop();
      let s = populations.get(top.u);
      for (const c of childrenMap.get(top.u)) s += subtreePop.get(c);
      subtreePop.set(top.u, s);
      order.push(top.u);
    }
  }
  const totalPop = subtreePop.get(root);
  const lo = target * (1 - tolerance);
  const hi = target * (1 + tolerance);
  const cuts = [];
  // Each non-root node u: cutting the edge u→parent gives subtree-pop on
  // u's side and (total - subtree-pop) on parent's side.
  for (const u of nodes) {
    if (parent.get(u) === -1) continue;
    const left = subtreePop.get(u);
    const right = totalPop - left;
    if (left >= lo && left <= hi && right >= lo && right <= hi) {
      cuts.push({ child: u, parent: parent.get(u), leftPop: left, rightPop: right });
    }
  }
  return { cuts, childrenMap, subtreePop };
}

// Given a chosen cut, return the set of nodes in the "child side" subtree.
// We BFS from the child node, refusing to traverse the cut edge.
function nodesOnChildSide(cut, childrenMap) {
  const out = new Set();
  const stack = [cut.child];
  while (stack.length) {
    const u = stack.pop();
    if (out.has(u)) continue;
    out.add(u);
    for (const c of childrenMap.get(u)) stack.push(c);
  }
  return out;
}

// Compute the set of (districtA, districtB) pairs that are graph-adjacent —
// i.e., pairs where some unit assigned to A has an adjacency edge to a unit
// assigned to B. We need this to pick "two adjacent districts" in step 2.
function adjacentDistrictPairs(assignment, adjacency, k) {
  const pairs = new Set(); // encoded as (a*k+b) with a<b
  for (let u = 0; u < assignment.length; u++) {
    const a = assignment[u];
    if (a < 0) continue;
    for (const v of adjacency[u]) {
      const b = assignment[v];
      if (b < 0 || a === b) continue;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      pairs.add(lo * k + hi);
    }
  }
  return [...pairs].map((code) => [Math.floor(code / k), code % k]);
}

// One ReCom step: pick adjacent district pair, sample tree, find balanced cut,
// apply if found. Returns {accepted: bool, fromDistricts?: [a,b]}.
//
// Pair-picking strategy: weight each adjacent pair by an imbalance score
// that favors pairs whose combined population differs most from 2 × target.
// This dramatically speeds up mixing from poor initial partitions: a
// uniform-random chain gets stuck in poorly-balanced states because most
// of the 150+ adjacent pairs are already near-balanced (rejected proposals
// don't help) while the few highly-imbalanced pairs are rarely sampled.
export function recomStep(state, rng, opts) {
  const { units, adjacency, target, tolerance, k } = opts;
  const { assignment, districtPop } = state;

  const pairs = adjacentDistrictPairs(assignment, adjacency, k);
  if (pairs.length === 0) return { accepted: false, reason: 'no_pairs' };

  // Weighted pick. Two competing goals:
  // (1) Productive pairs are those whose combined population is close to
  //     2 × target — these are the only pairs where a balanced cut can
  //     actually exist.
  // (2) Within productive pairs, prefer those whose individual districts
  //     are most imbalanced — those are the pairs whose acceptance helps
  //     the partition most.
  // Weight = productive_factor × imbalance_factor + small_uniform_floor.
  const weights = new Float64Array(pairs.length);
  let totW = 0;
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i];
    const sum = districtPop[a] + districtPop[b];
    // Productive factor: peaks at sum = 2×target, decays as sum departs.
    const sumDev = Math.abs(sum - 2 * target) / (2 * target);
    const productive = Math.exp(-sumDev * 4); // 1.0 at sum=2T, ~0.02 at sum=T or 3T
    // Imbalance factor: higher when individual districts are far off-target
    const indiv = (Math.abs(districtPop[a] - target) + Math.abs(districtPop[b] - target)) / target;
    const imbalanceFactor = 1 + indiv * 4;
    weights[i] = productive * imbalanceFactor + 0.02; // floor for ergodicity
    totW += weights[i];
  }
  let r = rng() * totW;
  let pickedIdx = pairs.length - 1;
  for (let i = 0; i < pairs.length; i++) {
    r -= weights[i];
    if (r <= 0) { pickedIdx = i; break; }
  }
  const [a, b] = pairs[pickedIdx];

  // Build the merged-region subgraph: all units assigned to a or b.
  const mergedNodes = [];
  for (let u = 0; u < assignment.length; u++) {
    if (assignment[u] === a || assignment[u] === b) mergedNodes.push(u);
  }
  if (mergedNodes.length < 2) return { accepted: false, reason: 'too_small' };

  const populations = new Map();
  for (const u of mergedNodes) populations.set(u, units[u].pop);

  const tree = uniformSpanningTree(mergedNodes, adjacency, rng);
  if (!tree) return { accepted: false, reason: 'no_tree' };

  const { cuts, childrenMap } = findBalancedCuts(tree, populations, target, tolerance);
  if (cuts.length === 0) return { accepted: false, reason: 'no_balanced_cut' };

  // Compactness filter: among the balanced cuts, prefer those that produce
  // geometrically-reasonable pieces. We approximate Polsby–Popper with a
  // graph-isoperimetric ratio — count adjacency-graph edges crossing the
  // candidate partition, divide by the smaller side's node count. Compact
  // pieces have low ratio (O(1/√N) for circular-ish regions in a planar
  // grid); elongated strips have high ratio (O(1)). The threshold
  // `compactness` is the max ratio we accept; cuts above it are filtered
  // before random selection. If no cut passes, we relax the threshold by
  // half until at least one cut survives — this keeps the chain ergodic
  // (no balanced cut is ever permanently unreachable) while strongly
  // biasing toward compact shapes in expectation.
  //
  // This is the discrete analog of the "edge isoperimetric" compactness
  // appendix in DeFord–Duchin–Solomon (2021); it's cheap (O(boundary) per
  // cut) and substrate-agnostic so it works equally well on counties,
  // fragments, and tracts.
  function isoRatio(cutObj) {
    const cSide = nodesOnChildSide(cutObj, childrenMap);
    let cross = 0;
    for (const u of mergedNodes) {
      const inC = cSide.has(u);
      for (const v of adjacency[u]) {
        if (!cSide.has(v) && inC) cross++;
        else if (cSide.has(v) && !inC) cross++;
      }
    }
    cross /= 2; // each edge double-counted
    const small = Math.min(cSide.size, mergedNodes.length - cSide.size);
    return small > 0 ? cross / small : Infinity;
  }
  const COMPACTNESS_THRESHOLD = opts.compactness ?? 1.5;
  let filteredCuts = cuts;
  let threshold = COMPACTNESS_THRESHOLD;
  for (let attempt = 0; attempt < 4; attempt++) {
    const surviving = cuts.filter((c) => isoRatio(c) <= threshold);
    if (surviving.length > 0) { filteredCuts = surviving; break; }
    threshold *= 2; // relax — guarantees the chain stays ergodic
  }

  const cut = filteredCuts[Math.floor(rng() * filteredCuts.length)];
  const childSide = nodesOnChildSide(cut, childrenMap);
  let newPopA = 0, newPopB = 0;
  for (const u of mergedNodes) {
    if (childSide.has(u)) { assignment[u] = a; newPopA += units[u].pop; }
    else { assignment[u] = b; newPopB += units[u].pop; }
  }
  districtPop[a] = newPopA;
  districtPop[b] = newPopB;
  return { accepted: true, fromDistricts: [a, b] };
}

// Build an initial partition via recursive spanning-tree bisection.
//
// Standard initial-partition strategy from the MGGG/ReCom literature:
// start with all units in one district, then repeatedly pick a district
// and bisect it into two roughly-equal-population halves via the same
// uniform-spanning-tree cut that ReCom uses for its main steps. Repeat
// until k districts. Each bisection is balanced by construction, so the
// final partition is already within tolerance.
//
// More robust than seed-and-grow when the unit graph has uneven
// population density (rural-county clumps, small isolated counties).
// Avoids the "stranded tiny district" problem that ReCom can't fix.
export function recomInitialPartition(units, adjacency, k, rng) {
  const N = units.length;
  if (N === 0 || k === 0) return null;
  if (k === 1) {
    return { assignment: new Int16Array(N).fill(0), districtPop: [units.reduce((s, u) => s + u.pop, 0)] };
  }

  const totalPop = units.reduce((s, u) => s + u.pop, 0);

  // Each district at any point represents a subset of units. We track
  // them as Sets for fast membership checks.
  const districts = []; // Set<unitIdx>
  districts.push(new Set(Array.from({ length: N }, (_, i) => i)));

  // Bisect until we have k districts. At each step pick the district
  // whose target-bisection-count is highest to ensure we end up with
  // exactly k districts at the end. (If we want 7 districts and we've
  // bisected the largest area into 3, the next step targets the area
  // that still needs more pieces.)
  // Track how many "pieces" each current district is supposed to become.
  const pieces = [k];
  while (districts.length < k) {
    // Pick the district with the most pieces remaining
    let pickIdx = 0;
    for (let i = 1; i < districts.length; i++) {
      if (pieces[i] > pieces[pickIdx]) pickIdx = i;
    }
    const set = districts[pickIdx];
    const numPieces = pieces[pickIdx];
    const setNodes = [...set];
    const setPop = setNodes.reduce((s, u) => s + units[u].pop, 0);

    // Bisect: aim for (a/numPieces, b/numPieces) where a + b = numPieces.
    // Use a = floor(numPieces/2), b = ceil. This produces balanced
    // splits even when k isn't a power of 2.
    const a = Math.floor(numPieces / 2);
    const b = numPieces - a;
    const targetA = setPop * a / numPieces;
    const tolerance = 0.20; // looser than final 5% — bisection just needs reasonable split

    // Try multiple spanning trees until we find a balanced cut
    let found = null;
    for (let trial = 0; trial < 60; trial++) {
      const tree = uniformSpanningTree(setNodes, adjacency, rng);
      if (!tree) continue;
      const populations = new Map();
      for (const u of setNodes) populations.set(u, units[u].pop);

      // Find cut closest to targetA pop
      const { parent, root } = tree;
      const childrenMap = new Map();
      for (const u of setNodes) childrenMap.set(u, []);
      for (const u of setNodes) {
        const p = parent.get(u);
        if (p !== -1) childrenMap.get(p).push(u);
      }
      // Subtree pops via post-order
      const subtreePop = new Map();
      const order = [];
      const stack = [{ u: root, expanded: false }];
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (!top.expanded) {
          top.expanded = true;
          for (const c of childrenMap.get(top.u)) stack.push({ u: c, expanded: false });
        } else {
          stack.pop();
          let s = populations.get(top.u);
          for (const c of childrenMap.get(top.u)) s += subtreePop.get(c);
          subtreePop.set(top.u, s);
          order.push(top.u);
        }
      }
      // Find best cut by closeness to targetA
      let bestCut = null, bestErr = Infinity;
      for (const u of setNodes) {
        if (parent.get(u) === -1) continue;
        const left = subtreePop.get(u);
        const err = Math.abs(left - targetA);
        if (err < bestErr) {
          bestErr = err;
          bestCut = { child: u, leftPop: left, rightPop: setPop - left };
        }
      }
      if (bestCut && bestCut.leftPop >= targetA * (1 - tolerance) && bestCut.leftPop <= targetA * (1 + tolerance)) {
        // Build child-side set
        const childSide = new Set();
        const stk2 = [bestCut.child];
        while (stk2.length) {
          const u = stk2.pop();
          if (childSide.has(u)) continue;
          childSide.add(u);
          for (const c of childrenMap.get(u)) stk2.push(c);
        }
        found = { childSide, leftPop: bestCut.leftPop, rightPop: bestCut.rightPop };
        break;
      }
    }

    if (!found) {
      // Couldn't find a balanced bisection. As a fallback, bisect
      // arbitrarily by tree-DFS order (still produces contiguous halves).
      const tree = uniformSpanningTree(setNodes, adjacency, rng);
      if (!tree) {
        // Pathological: just split nodes in half by index
        const childSide = new Set(setNodes.slice(0, Math.floor(setNodes.length / 2)));
        const leftPop = [...childSide].reduce((s, u) => s + units[u].pop, 0);
        found = { childSide, leftPop, rightPop: setPop - leftPop };
      } else {
        const { parent, root } = tree;
        const childrenMap = new Map();
        for (const u of setNodes) childrenMap.set(u, []);
        for (const u of setNodes) {
          const p = parent.get(u);
          if (p !== -1) childrenMap.get(p).push(u);
        }
        const subtreePop = new Map();
        const stack = [{ u: root, expanded: false }];
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (!top.expanded) {
            top.expanded = true;
            for (const c of childrenMap.get(top.u)) stack.push({ u: c, expanded: false });
          } else {
            stack.pop();
            let s = units[top.u].pop;
            for (const c of childrenMap.get(top.u)) s += subtreePop.get(c);
            subtreePop.set(top.u, s);
          }
        }
        let bestCut = null, bestErr = Infinity;
        for (const u of setNodes) {
          if (parent.get(u) === -1) continue;
          const err = Math.abs(subtreePop.get(u) - targetA);
          if (err < bestErr) {
            bestErr = err;
            bestCut = { child: u, leftPop: subtreePop.get(u) };
          }
        }
        const childSide = new Set();
        const stk2 = [bestCut.child];
        while (stk2.length) {
          const u = stk2.pop();
          if (childSide.has(u)) continue;
          childSide.add(u);
          for (const c of childrenMap.get(u)) stk2.push(c);
        }
        found = { childSide, leftPop: bestCut.leftPop, rightPop: setPop - bestCut.leftPop };
      }
    }

    // Replace districts[pickIdx] with two new districts
    const left = found.childSide;
    const right = new Set();
    for (const u of setNodes) if (!left.has(u)) right.add(u);
    districts[pickIdx] = left;
    districts.push(right);
    pieces[pickIdx] = a;
    pieces.push(b);
  }

  // Convert districts to assignment array + per-district pop array
  const assignment = new Int16Array(N).fill(-1);
  const districtPop = new Array(k).fill(0);
  for (let d = 0; d < districts.length; d++) {
    let p = 0;
    for (const u of districts[d]) {
      assignment[u] = d;
      p += units[u].pop;
    }
    districtPop[d] = p;
  }
  return { assignment, districtPop };
}

// Run ReCom for one state. Returns the final partition (used as "primary"
// plan) and optionally an array of intermediate samples (used to build the
// ensemble). Uses a graduated-tolerance schedule: starts very loose to
// allow the chain to find any valid cut from a poor initial partition,
// then tightens to the target tolerance over the burn-in period.
export function runReCom(stateUnits, stateAdjacency, k, seed, options = {}) {
  const {
    burnIn = 200,
    numSamples = 0,
    sampleEvery = 25,
    tolerance = 0.05,
    compactness = 1.5,
  } = options;

  if (k === 1) {
    const assignment = new Int16Array(stateUnits.length).fill(0);
    const districtPop = [stateUnits.reduce((s, u) => s + u.pop, 0)];
    return { assignment, districtPop, accepts: 0, rejects: 0, samples: [] };
  }

  const rng = makeRng(seed);
  const N = stateUnits.length;
  const totalPop = stateUnits.reduce((s, u) => s + u.pop, 0);
  const target = totalPop / k;

  const initial = recomInitialPartition(stateUnits, stateAdjacency, k, rng);
  if (!initial) return null;
  const state = { assignment: initial.assignment, districtPop: initial.districtPop };

  let accepts = 0, rejects = 0;
  const samples = [];

  // Graduated tolerance: start loose (allow far-from-balanced cuts so the
  // chain can move at all), then tighten geometrically toward the target.
  const startTol = Math.max(0.5, tolerance * 10);
  const burnInPhases = 4;
  const stepsPerPhase = Math.ceil(burnIn / burnInPhases);
  for (let phase = 0; phase < burnInPhases; phase++) {
    const phaseTol = startTol * Math.pow(tolerance / startTol, (phase + 1) / burnInPhases);
    const opts = { units: stateUnits, adjacency: stateAdjacency, target, tolerance: phaseTol, k, compactness };
    for (let i = 0; i < stepsPerPhase; i++) {
      const r = recomStep(state, rng, opts);
      if (r.accepted) accepts++; else rejects++;
    }
  }

  // Polish phase: greedy boundary-unit transfers that improve max deviation.
  // ReCom alone often leaves a few stranded outlier districts (geographically
  // isolated regions where adjacent populations don't sum to anything close
  // to 2 × target, so no merge-and-cut can rebalance them). The polish phase
  // does targeted hill-climbing — find the most-deviated district, transfer
  // a boundary unit from/to its best neighbor — which can rescue these
  // districts where the chain cannot. Each transfer is contiguity-checked.
  //
  // To escape local minima, after each polish stalls, we run a short ReCom
  // burst to perturb the partition out of its stuck state, then re-polish.
  // Up to PERTURB_CYCLES of (perturb + polish) follow the initial polish.
  // The current state best (lowest maxDev) is preserved across cycles.
  let bestSnapshot = null;
  function maxDevOf(s) {
    let mx = 0;
    for (const p of s.districtPop) {
      const d = Math.abs(p - target) / target;
      if (d > mx) mx = d;
    }
    return mx;
  }
  function snapshot() {
    return { assignment: new Int16Array(state.assignment), districtPop: state.districtPop.slice() };
  }
  function restore(s) {
    state.assignment.set(s.assignment);
    state.districtPop = s.districtPop.slice();
  }
  function isContigAfterRemove(districtId, removedIdx) {
    const districtNodes = [];
    for (let u = 0; u < N; u++) if (state.assignment[u] === districtId && u !== removedIdx) districtNodes.push(u);
    if (districtNodes.length === 0) return true;
    const visited = new Set([districtNodes[0]]);
    const queue = [districtNodes[0]];
    while (queue.length) {
      const u = queue.pop();
      for (const v of stateAdjacency[u]) {
        if (v !== removedIdx && state.assignment[v] === districtId && !visited.has(v)) {
          visited.add(v); queue.push(v);
        }
      }
    }
    return visited.size === districtNodes.length;
  }
  let polishMoves = 0;
  // Polish iteration cap. With the maintained boundary-units set below
  // (only units adjacent to a different district are scanned), each iter
  // is fast even at N=8000. The cap exists only as a runaway-safety
  // ceiling — convergence and stuck-detection terminate the loop earlier
  // in practice.
  const maxPolish = Math.min(N * 30, 50000);

  // Maintained boundary-units set: a unit `u` is on a boundary iff at
  // least one of its neighbors belongs to a different district. We
  // build this once up front and update it incrementally on each move.
  const onBoundary = new Uint8Array(N);
  for (let u = 0; u < N; u++) {
    const da = state.assignment[u];
    if (da < 0) continue;
    for (const v of stateAdjacency[u]) {
      if (state.assignment[v] !== da) { onBoundary[u] = 1; break; }
    }
  }
  function refreshBoundary(u) {
    const da = state.assignment[u];
    let bd = 0;
    if (da >= 0) {
      for (const v of stateAdjacency[u]) {
        if (state.assignment[v] !== da) { bd = 1; break; }
      }
    }
    onBoundary[u] = bd;
  }

  // Track stuck counter. When polish fails on the most-deviated district,
  // try the next-most-deviated, etc. — sometimes a fix elsewhere unblocks
  // the original. Only bail when no district has any improving move.
  let stuckOn = -1, stuckCount = 0;
  const stuckLimit = Math.max(3, Math.ceil(k * 0.25));

  const PERTURB_CYCLES = 3;
  const PERTURB_STEPS = Math.max(20, Math.ceil(k * 4));
  for (let cycle = 0; cycle <= PERTURB_CYCLES; cycle++) {
   if (cycle > 0) {
    // Stuck: snapshot best, perturb with looser-tolerance ReCom steps, retry
    const md0 = maxDevOf(state);
    if (!bestSnapshot || md0 < maxDevOf(bestSnapshot)) bestSnapshot = snapshot();
    if (md0 <= tolerance) break; // Already met goal
    // Perturb with a wider tolerance so the chain can move
    const perturbTol = Math.max(tolerance * 2, 0.10);
    // Use the relaxed compactness threshold during perturbation too so the
    // chain has the same cut-pool semantics as the burn-in did.
    const opts = { units: stateUnits, adjacency: stateAdjacency, target, tolerance: perturbTol, k, compactness };
    for (let i = 0; i < PERTURB_STEPS; i++) recomStep(state, rng, opts);
    // Refresh boundary cache after the burst
    for (let u = 0; u < N; u++) {
      const da = state.assignment[u];
      let bd = 0;
      if (da >= 0) {
        for (const v of stateAdjacency[u]) {
          if (state.assignment[v] !== da) { bd = 1; break; }
        }
      }
      onBoundary[u] = bd;
    }
    stuckOn = -1; stuckCount = 0;
   }
  for (let iter = 0; iter < maxPolish; iter++) {
    // Sort districts by deviation (descending) to try worst first
    const districtOrder = [];
    for (let d = 0; d < k; d++) {
      const dev = Math.abs(state.districtPop[d] - target) / target;
      if (dev > tolerance) districtOrder.push({ d, dev });
    }
    if (districtOrder.length === 0) break; // converged
    districtOrder.sort((a, b) => b.dev - a.dev);

    let movedThisIter = false;
    const topMaxD = districtOrder[0].d;

    // Try each candidate district in deviation-order, until one yields an
    // improving move. This handles cases where the most-deviated district
    // has no unblocked moves but the second/third-most do — sometimes
    // moving them creates space for a later fix on the worst.
    for (const { d: maxD } of districtOrder) {
      const overweight = state.districtPop[maxD] > target;
      let bestUnit = -1, bestPartner = -1, bestImprove = 0;
      const blocked = new Set();

      while (true) {
        bestUnit = -1; bestPartner = -1; bestImprove = 0;
        if (overweight) {
          for (let u = 0; u < N; u++) {
            if (!onBoundary[u]) continue;
            if (state.assignment[u] !== maxD) continue;
            if (blocked.has(u)) continue;
            for (const v of stateAdjacency[u]) {
              const partner = state.assignment[v];
              if (partner === maxD || partner === -1) continue;
              if (state.districtPop[partner] >= state.districtPop[maxD]) continue;
              const beforeMax = Math.max(Math.abs(state.districtPop[maxD] - target), Math.abs(state.districtPop[partner] - target));
              const afterFrom = Math.abs(state.districtPop[maxD] - stateUnits[u].pop - target);
              const afterTo = Math.abs(state.districtPop[partner] + stateUnits[u].pop - target);
              const afterMax = Math.max(afterFrom, afterTo);
              const improve = beforeMax - afterMax;
              if (improve > bestImprove) {
                bestImprove = improve; bestUnit = u; bestPartner = partner;
              }
            }
          }
        } else {
          for (let u = 0; u < N; u++) {
            if (!onBoundary[u]) continue;
            const sourceD = state.assignment[u];
            if (sourceD === maxD || sourceD === -1) continue;
            if (blocked.has(u)) continue;
            if (state.districtPop[sourceD] <= state.districtPop[maxD]) continue;
            let adjToMax = false;
            for (const v of stateAdjacency[u]) if (state.assignment[v] === maxD) { adjToMax = true; break; }
            if (!adjToMax) continue;
            const beforeMax = Math.max(Math.abs(state.districtPop[sourceD] - target), Math.abs(state.districtPop[maxD] - target));
            const afterFrom = Math.abs(state.districtPop[sourceD] - stateUnits[u].pop - target);
            const afterTo = Math.abs(state.districtPop[maxD] + stateUnits[u].pop - target);
            const afterMax = Math.max(afterFrom, afterTo);
            const improve = beforeMax - afterMax;
            if (improve > bestImprove) {
              // bestPartner stores the DESTINATION district. In the
              // underweight branch we're moving a unit FROM `sourceD`
              // (the unit's current district) INTO maxD (the underweight
              // target), so the destination is maxD, not sourceD.
              bestImprove = improve; bestUnit = u; bestPartner = maxD;
            }
          }
        }
        if (bestUnit === -1) break;
        // Contiguity check; if it fails, blocklist and re-search.
        const fromDcheck = state.assignment[bestUnit];
        if (isContigAfterRemove(fromDcheck, bestUnit)) break;
        blocked.add(bestUnit);
      }

      if (bestUnit === -1) continue; // try next deviated district

      // Apply the move
      const fromD = state.assignment[bestUnit];
      const toD = bestPartner;
      state.districtPop[fromD] -= stateUnits[bestUnit].pop;
      state.districtPop[toD] += stateUnits[bestUnit].pop;
      state.assignment[bestUnit] = toD;
      refreshBoundary(bestUnit);
      for (const v of stateAdjacency[bestUnit]) refreshBoundary(v);
      polishMoves++;
      movedThisIter = true;
      break; // re-evaluate worst district from scratch on next iter
    }

    if (!movedThisIter) {
      // No district had any improving single-unit move. If this happens
      // repeatedly on the same top-deviated district, we've reached a
      // local minimum polish can't escape — bail. The outer perturb-cycle
      // loop will then take a ReCom burst and re-polish; that can often
      // unstick a cluster of similarly-imbalanced districts.
      if (topMaxD === stuckOn) { stuckCount++; if (stuckCount >= stuckLimit) break; }
      else { stuckOn = topMaxD; stuckCount = 1; }
      break;
    } else {
      stuckOn = -1; stuckCount = 0;
    }
  }
   // Stop the outer perturb-cycle loop the moment the partition meets the
   // target; perturbing further would only worsen it.
   if (maxDevOf(state) <= tolerance) break;
  }
  // Pick whichever was better: current state or any earlier snapshot.
  if (bestSnapshot && maxDevOf(bestSnapshot) < maxDevOf(state)) restore(bestSnapshot);

  // Sample phase: continue running with target tolerance (after polish).
  if (numSamples > 0) {
    const opts = { units: stateUnits, adjacency: stateAdjacency, target, tolerance, k, compactness };
    samples.push({
      assignment: new Int16Array(state.assignment),
      districtPop: state.districtPop.slice(),
    });
    let acceptsSinceSample = 0;
    while (samples.length < numSamples) {
      const r = recomStep(state, rng, opts);
      if (r.accepted) { accepts++; acceptsSinceSample++; }
      else rejects++;
      if (acceptsSinceSample >= sampleEvery) {
        samples.push({
          assignment: new Int16Array(state.assignment),
          districtPop: state.districtPop.slice(),
        });
        acceptsSinceSample = 0;
      }
      if (accepts + rejects > burnIn + numSamples * sampleEvery * 30) break;
    }
  }

  return { ...state, accepts, rejects, polishMoves, samples };
}
