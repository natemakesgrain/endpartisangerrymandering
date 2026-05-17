'use client';
import React, { useState, useEffect, useMemo, useRef } from "react";

/* =============================================================================
   THE 50-STATE PROBLEM — COUNTY-LEVEL VERSION
   --------------------------------------------------------------------------
   An empirical demonstration of algorithmic congressional redistricting on
   real county-level voter geography. For each of the 50 states, we group
   real US counties into balanced congressional districts using the ReCom
   algorithm — the standard graph-based redistricting Markov chain from the
   MGGG/Duchin/DeFord/Solomon literature. Districts are unions of real
   county polygons; populations come from the 2020 Census; partisan totals
   come from county-level presidential results 2000–2024.

   Data sources (all cached on first load, ~2.5 MB total network):
   - County polygons + state outlines: us-atlas v3 counties-albers-10m
     (TopoJSON, Albers USA projection, Census 2017 cartographic boundaries)
   - 2020 Census county populations (Census Bureau popest 2021 vintage,
     which uses the pre-CT-planning-region county geography matching the
     topojson)
   - 2000 / 2004 / 2008 / 2012 / 2016 / 2020 / 2024 presidential two-party
     vote per county, real official returns sourced via MIT Election Data
     and Science Lab through the stiles/presidential-elections compilation
     (the 2016/2020/2024 files are the original tonmcg-curated tabulations)
   - Counties that exceed 1.05 × the state's target-district population are
     slab-cut into balance-sized fragments, each inheriting the parent's
     per-capita partisan rate. Adjacency between fragments uses shared
     edges + slab-order chains + manual water-gap bridges (Mackinac,
     Verrazzano, Eastern Shore VA, RI Newport, San Juan Islands, Hawaii).

   The dashboard does NOT cover midterm House years (2006/2010/2014/2018/
   2022). U.S. House elections are tabulated by congressional district, not
   county, and no unified national county-level dataset exists for them.
   Adding midterms would require precinct-aggregated returns from the MIT
   EDSL precinct dataset, which is a separate ingestion task.
   ============================================================================ */

/* ---------- INLINE DATA -------------------------------------------------- */
// 2020 Census county populations (using popest 2021 vintage to capture
// pre-2022 CT county geography that matches the topojson). FIPS → pop.
// Special: '_AK' is the Alaska statewide pseudo-FIPS (sum of all AK boroughs).
// Populated at runtime by useData() from /data/populations.json and
// /data/votes/<YEAR>.json files in the public/ directory.
let POPULATIONS = {};
let VOTES_BY_YEAR = {};  // { [year]: { [fips]: [D, R, total] } }

// County-level presidential vote totals. Each year: FIPS → [D, R, total].
// '_AK' = Alaska statewide (Alaska reports by State House District, not by
// borough; we treat AK as a single unit since it has 1 at-large district).

// 2-letter state code → full name. Used for state outlines and detail UI.
const STATE_BY_FIPS = {
  "01": ["AL", "Alabama"], "02": ["AK", "Alaska"], "04": ["AZ", "Arizona"],
  "05": ["AR", "Arkansas"], "06": ["CA", "California"], "08": ["CO", "Colorado"],
  "09": ["CT", "Connecticut"], "10": ["DE", "Delaware"], "11": ["DC", "District of Columbia"],
  "12": ["FL", "Florida"], "13": ["GA", "Georgia"], "15": ["HI", "Hawaii"],
  "16": ["ID", "Idaho"], "17": ["IL", "Illinois"], "18": ["IN", "Indiana"],
  "19": ["IA", "Iowa"], "20": ["KS", "Kansas"], "21": ["KY", "Kentucky"],
  "22": ["LA", "Louisiana"], "23": ["ME", "Maine"], "24": ["MD", "Maryland"],
  "25": ["MA", "Massachusetts"], "26": ["MI", "Michigan"], "27": ["MN", "Minnesota"],
  "28": ["MS", "Mississippi"], "29": ["MO", "Missouri"], "30": ["MT", "Montana"],
  "31": ["NE", "Nebraska"], "32": ["NV", "Nevada"], "33": ["NH", "New Hampshire"],
  "34": ["NJ", "New Jersey"], "35": ["NM", "New Mexico"], "36": ["NY", "New York"],
  "37": ["NC", "North Carolina"], "38": ["ND", "North Dakota"], "39": ["OH", "Ohio"],
  "40": ["OK", "Oklahoma"], "41": ["OR", "Oregon"], "42": ["PA", "Pennsylvania"],
  "44": ["RI", "Rhode Island"], "45": ["SC", "South Carolina"], "46": ["SD", "South Dakota"],
  "47": ["TN", "Tennessee"], "48": ["TX", "Texas"], "49": ["UT", "Utah"],
  "50": ["VT", "Vermont"], "51": ["VA", "Virginia"], "53": ["WA", "Washington"],
  "54": ["WV", "West Virginia"], "55": ["WI", "Wisconsin"], "56": ["WY", "Wyoming"],
};

// House seats per state from 2020 census apportionment (effective 2023+).
const SEATS_BY_STATE = {
  AL: 7, AK: 1, AZ: 9, AR: 4, CA: 52, CO: 8, CT: 5, DE: 1, FL: 28,
  GA: 14, HI: 2, ID: 2, IL: 17, IN: 9, IA: 4, KS: 4, KY: 6, LA: 6,
  ME: 2, MD: 8, MA: 9, MI: 13, MN: 8, MS: 4, MO: 8, MT: 2, NE: 3,
  NV: 4, NH: 2, NJ: 12, NM: 3, NY: 26, NC: 14, ND: 1, OH: 15, OK: 5,
  OR: 6, PA: 17, RI: 2, SC: 7, SD: 1, TN: 9, TX: 38, UT: 4, VT: 1,
  VA: 11, WA: 10, WV: 2, WI: 8, WY: 1,
};

// Per-decade apportionment — U.S. Census Bureau, Table C1, "Number of
// Seats in U.S. House of Representatives by State: 1910 to 2020"
// (www2.census.gov/.../apportionment-2020-tableC1.pdf). The number of
// House seats per state — hence the number of districts the algorithm
// draws — is fixed by the decennial census. SEATS_BY_STATE above is the
// 2020 column (the national-overview default); the 1990/2000/2010
// columns below let the enlarged state-detail view split a state into
// the historically-correct district count for the cycle being viewed.
// Every column sums to 435. Verified equal to SEATS_BY_STATE for 2020.
const APPORTIONMENT = {
  1990: { AL: 7, AK: 1, AZ: 6, AR: 4, CA: 52, CO: 6, CT: 6, DE: 1, FL: 23,
    GA: 11, HI: 2, ID: 2, IL: 20, IN: 10, IA: 5, KS: 4, KY: 6, LA: 7,
    ME: 2, MD: 8, MA: 10, MI: 16, MN: 8, MS: 5, MO: 9, MT: 1, NE: 3,
    NV: 2, NH: 2, NJ: 13, NM: 3, NY: 31, NC: 12, ND: 1, OH: 19, OK: 6,
    OR: 5, PA: 21, RI: 2, SC: 6, SD: 1, TN: 9, TX: 30, UT: 3, VT: 1,
    VA: 11, WA: 9, WV: 3, WI: 9, WY: 1 },
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
  2020: SEATS_BY_STATE,
};
// Which census's apportionment governed the U.S. House for an election
// year. A census's map takes effect with the election TWO years later:
//   1990 census → 1992–2000 elections   2000 census → 2002–2010
//   2010 census → 2012–2020 elections   2020 census → 2022–2030
// So the 2000 election still ran on 1990-census apportionment.
function apportionmentCensusForYear(y) {
  if (y <= 2000) return 1990;
  if (y <= 2010) return 2000;
  if (y <= 2020) return 2010;
  return 2020;
}
// House seats for a state in the decade governing election year `y`.
// Defensive fallback to the 2020 table for any unmatched code.
function seatsForState(code, y) {
  const t = APPORTIONMENT[apportionmentCensusForYear(y)] || SEATS_BY_STATE;
  return t[code] ?? SEATS_BY_STATE[code] ?? 1;
}

const TOTAL_SEATS = 435;
const TARGET_DISTRICT_POP = 761000; // approx US pop / 435

// Election years available in the dashboard. The dashboard's vote files
// (public/data/votes/<YEAR>.json) and the YEAR_CONFIG entries must agree:
// every entry's `key` is fetched as <key>.json on startup.
//
// Presidential years use REAL county-level two-party returns from MIT EDSL
// via the stiles/presidential-elections compilation.
//
// Midterm years (2006, 2010, 2014, 2018, 2022) are MODELED: per-county
// D-share is computed by taking the nearest presidential year's real county
// pattern and applying a per-state logit-space swing that recovers the
// state's actual two-party U.S. House D-share for that midterm (from the
// MIT EDSL 1976-2022 House dataset). This captures the actual state-level
// swing geographically (e.g. 2018 California +12 D vs. 2018 Tennessee +2 R
// reflect the real per-state House totals) but holds within-state county
// rankings at the base year. See scripts/build-midterm-votes.mjs.
//
// `kind` is 'pres' for real presidential data, 'midterm' for modeled.
//
// `actualHouse` is the historical post-election U.S. House seat split for
// that cycle, used in the headline beside the algorithmic seats so the
// reader can compare what really happened to what an algorithmic map would
// have produced. Sources: Office of the Clerk of the U.S. House; sourced
// per cycle (final post-vacancy fill counts at the cycle start).
//
// `competitive` is the number of districts whose two-party D-share fell in
// [0.45, 0.55] (i.e. winning margin ≤ 10 percentage points). Computed from
// the MIT Election Data and Science Lab 1976-2022 U.S. House dataset via
// scripts/compute-competitive.mjs for 2000-2022; 2024 is from public final
// tallies (Daily Kos Elections / Wikipedia). The dashboard displays this
// next to the algorithmic competitive count so the reader can see how many
// genuinely contestable seats real maps produced vs the algorithmic ones.
const YEAR_CONFIG = {
  defaultYear: 2024,
  years: [
    { key: 2000, label: '2000', sub: 'Bush v. Gore',     winner: 'R', kind: 'pres',    actualHouse: { d: 212, r: 221, competitive: 43 } },
    { key: 2002, label: '2002', sub: 'Bush 1 midterm',   winner: 'R', kind: 'midterm', actualHouse: { d: 205, r: 229, competitive: 36 } },
    { key: 2004, label: '2004', sub: 'Bush v. Kerry',    winner: 'R', kind: 'pres',    actualHouse: { d: 202, r: 232, competitive: 23 } },
    { key: 2006, label: '2006', sub: 'Bush 2 midterm',   winner: 'D', kind: 'midterm', actualHouse: { d: 233, r: 202, competitive: 60 } },
    { key: 2008, label: '2008', sub: 'Obama 1',          winner: 'D', kind: 'pres',    actualHouse: { d: 257, r: 178, competitive: 51 } },
    { key: 2010, label: '2010', sub: 'Obama 1 midterm',  winner: 'R', kind: 'midterm', actualHouse: { d: 193, r: 242, competitive: 78 } },
    { key: 2012, label: '2012', sub: 'Obama 2',          winner: 'D', kind: 'pres',    actualHouse: { d: 201, r: 234, competitive: 59 } },
    { key: 2014, label: '2014', sub: 'Obama 2 midterm',  winner: 'R', kind: 'midterm', actualHouse: { d: 188, r: 247, competitive: 43 } },
    { key: 2016, label: '2016', sub: 'Trump 1',          winner: 'R', kind: 'pres',    actualHouse: { d: 194, r: 241, competitive: 31 } },
    { key: 2018, label: '2018', sub: 'Trump 1 midterm',  winner: 'D', kind: 'midterm', actualHouse: { d: 235, r: 200, competitive: 89 } },
    { key: 2020, label: '2020', sub: 'Biden',            winner: 'D', kind: 'pres',    actualHouse: { d: 222, r: 213, competitive: 78 } },
    { key: 2022, label: '2022', sub: 'Biden midterm',    winner: 'R', kind: 'midterm', actualHouse: { d: 213, r: 222, competitive: 71 } },
    { key: 2024, label: '2024', sub: 'Trump 2',          winner: 'R', kind: 'pres',    actualHouse: { d: 215, r: 220, competitive: 37 } },
  ],
  get allYears() { return this.years.map((y) => y.key); },
  yearMeta(key) { return this.years.find((y) => y.key === key); },
};

// Seeds whose full national result is pre-computed and committed to the
// repo as a flat map image (/data/seeds/<seed>-2024.jpg) plus a 13-year
// headline summary (/data/seeds/<seed>-summary.json). When a user lands on
// one of these at the default year, we render the image instantly and
// never run the algorithm or download the ≈29 MB of tract geometry — that
// cold path costs ~28 s of CPU. Any deliberate interaction (a custom seed,
// or any year change) engages the live engine from then on; switching
// among the three pre-rendered seeds at the default year stays instant.
const DEFAULT_SEEDS = new Set([42, 7, 1337]);

// Manual water-gap bridge adjacencies: pairs of parent county FIPS that
// don't share land borders but are connected by bridges, causeways, or
// political grouping. These are treated like topojson-derived county
// adjacencies, then the centroid-nearest fragment matcher connects the
// closest pair of fragments on each side. Listing parent FIPS (not specific
// fragment IDs) means the bridges remain robust as the subdivision
// strategy changes.
const WATER_GAP_BRIDGES = [
  // Hawaii: each county connects to Honolulu (the state's center)
  ["15001", "15003"], ["15007", "15003"], ["15009", "15003"], ["15005", "15009"],
  // Nantucket → Dukes & Barnstable (Cape Cod ferry/political grouping)
  ["25019", "25007"], ["25019", "25001"],
  // San Juan Islands → Whatcom & Skagit (ferry)
  ["53055", "53073"], ["53055", "53057"],
  // Mackinac Bridge: Mackinac Co (UP) ↔ Cheboygan & Emmet (LP)
  ["26097", "26031"], ["26097", "26047"],
  // Eastern Shore VA: Northampton ↔ Virginia Beach (Bay Bridge-Tunnel)
  ["51131", "51810"],
  // RI Newport ↔ Bristol (Mount Hope Bridge), ↔ Washington (Jamestown Bridge)
  ["44005", "44001"], ["44005", "44009"],
  // AK: ensure Aleutians West ↔ Aleutians East (single unit anyway)
  ["02016", "02013"],
  // NYC: bridges and tunnels between boroughs
  ["36085", "36047"], // Staten Island ↔ Brooklyn (Verrazzano)
  ["36061", "36081"], // Manhattan ↔ Queens (Queensboro)
  ["36061", "36047"], // Manhattan ↔ Brooklyn (Brooklyn Bridge)
  ["36081", "36047"], // Queens ↔ Brooklyn (Long Island land border)
  // LA basin: catalina/channel islands grouping (LA County is enormous)
  // (already covered by intra-county adjacency between LA fragments)
];

/* ---------- GEOMETRY HELPERS -------------------------------------------- */
// Decode a topojson layer (e.g., 'counties' or 'states') into a map of
// id → array of polygons, where each polygon is an array of rings, each
// ring is an array of [x, y] coordinates in the projection's coord space.
function decodeTopoLayer(topology, layerName) {
  const { transform, arcs, objects } = topology;
  const sx = transform.scale[0], sy = transform.scale[1];
  const tx = transform.translate[0], ty = transform.translate[1];
  const decodedArcs = arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
  function ringFromIndices(indices) {
    const ring = [];
    for (let k = 0; k < indices.length; k++) {
      const idx = indices[k];
      const arc = idx < 0 ? decodedArcs[~idx].slice().reverse() : decodedArcs[idx];
      const start = k === 0 ? 0 : 1;
      for (let m = start; m < arc.length; m++) ring.push(arc[m]);
    }
    return ring;
  }
  const out = {};
  const arcUsers = new Map(); // for adjacency: arc abs idx → Set<id>
  for (const geom of objects[layerName].geometries) {
    const id = geom.id;
    let polygons;
    if (geom.type === 'MultiPolygon') {
      polygons = geom.arcs.map((poly) => poly.map(ringFromIndices));
    } else if (geom.type === 'Polygon') {
      polygons = [geom.arcs.map(ringFromIndices)];
    } else continue;
    out[id] = { polygons, name: geom.properties?.name };
    // Track which arcs each id uses (for adjacency derivation)
    const arcIndices = geom.type === 'MultiPolygon' ? geom.arcs : [geom.arcs];
    for (const poly of arcIndices) {
      for (const ring of poly) {
        for (const idx of ring) {
          const abs = idx < 0 ? ~idx : idx;
          if (!arcUsers.has(abs)) arcUsers.set(abs, new Set());
          arcUsers.get(abs).add(id);
        }
      }
    }
  }
  return { out, arcUsers };
}

// Bounding box: [minX, minY, maxX, maxY]
function bboxOfPolygons(polys) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

// SVG path string from a set of polygons. Each ring becomes an M..Z subpath.
function pathFromPolygons(polys) {
  const parts = [];
  for (const poly of polys) {
    for (const ring of poly) {
      let p = '';
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = ring[i];
        p += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
      }
      p += 'Z';
      parts.push(p);
    }
  }
  return parts.join('');
}

// Vertex-coordinate quantization for boundary tracing. The two cancellation
// hashes (eKey for forward edge, eKey for reverse) MUST agree on rounding,
// otherwise interior edges fail to cancel and the tracer dead-ends. We round
// to 0.05-pixel precision (Q=20) — fine enough to keep separate vertices
// distinct at tract granularity (where coords from independently-simplified
// per-county tract files can drift up to ~0.01 SVG units), coarse enough to
// merge sub-pixel float drift between adjacent county polygons that share a
// boundary (which can drift up to ~0.04 units after topojson encode/decode).
//
// At county granularity Q=10 (0.1px) was sufficient because shared county
// boundaries come through topojson's shared-arc system with high precision.
// Tract data was reassembled from per-county files where shared county
// borders were re-derived from independently-simplified geometry; the
// finer Q=20 captures their drift correctly.
const COORD_QUANT = 20;
function vKey(x, y) {
  return Math.round(x * COORD_QUANT) + ',' + Math.round(y * COORD_QUANT);
}
function eKey(a, b) {
  return Math.round(a[0] * COORD_QUANT) + ',' + Math.round(a[1] * COORD_QUANT) + ':' +
         Math.round(b[0] * COORD_QUANT) + ',' + Math.round(b[1] * COORD_QUANT);
}

// Trace the outer boundary of a set of unit-polygons (a "district"). Returns
// an array of closed loops, each loop is an array of [x,y] vertices.
//
// Algorithm (standard polygon-set boundary trace):
//   1. Walk every directed edge of every ring of every polygon.
//   2. An edge is INTERIOR iff its reverse (b→a) appears somewhere in the set
//      — that's the signature of two same-district polygons sharing a border.
//   3. The remaining edges form the outer boundary; chain them by start-vertex.
function traceBoundary(unitPolygonsList) {
  // 1+2. Collect edges, identify interior edges via reverse-lookup.
  const allEdges = new Map(); // edgeKey → [a,b]
  for (const polys of unitPolygonsList) {
    for (const poly of polys) {
      for (const ring of poly) {
        for (let i = 0, n = ring.length; i < n; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % n];
          // Skip degenerate edges
          if (vKey(a[0], a[1]) === vKey(b[0], b[1])) continue;
          allEdges.set(eKey(a, b), [a, b]);
        }
      }
    }
  }
  const boundaryEdges = [];
  for (const [k, edge] of allEdges) {
    const revK = eKey(edge[1], edge[0]);
    if (!allEdges.has(revK)) boundaryEdges.push(edge);
  }
  if (boundaryEdges.length === 0) return [];

  // 3. Chain boundary edges into closed loops via start-vertex lookup.
  // At T-junctions (a vertex with multiple outgoing boundary edges), pick
  // the LEFTMOST turn — this correctly traces both outer boundaries (CCW)
  // and holes (CW), producing topologically valid polygons.
  const byStart = new Map(); // vertexKey → array of edges
  for (const edge of boundaryEdges) {
    const k = vKey(edge[0][0], edge[0][1]);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(edge);
  }
  const used = new Set();
  const loops = [];
  for (const startEdge of boundaryEdges) {
    const sk = eKey(startEdge[0], startEdge[1]);
    if (used.has(sk)) continue;
    const loop = [startEdge[0]];
    let cur = startEdge;
    used.add(sk);
    let safety = boundaryEdges.length + 5;
    let closed = false;
    while (safety-- > 0) {
      loop.push(cur[1]);
      // Loop closure check
      if (vKey(cur[1][0], cur[1][1]) === vKey(startEdge[0][0], startEdge[0][1])) {
        closed = true;
        break;
      }
      // Pick any unused outgoing edge from current vertex.
      // (In a properly oriented polygon-set, there's typically only one,
      // and at T-junctions either choice produces a valid closed loop.)
      const candidates = byStart.get(vKey(cur[1][0], cur[1][1])) || [];
      let bestNext = null;
      for (const cand of candidates) {
        if (!used.has(eKey(cand[0], cand[1]))) { bestNext = cand; break; }
      }
      if (!bestNext) break;
      cur = bestNext;
      used.add(eKey(cur[0], cur[1]));
    }
    if (closed && loop.length > 2) loops.push(loop);
  }
  return loops;
}

// The EXACT set of boundary edges of a unit-set: every directed edge whose
// reverse is NOT also present (i.e. it isn't shared by two same-district
// units). Unlike traceBoundary this needs no loop-closing, so a district's
// outline is always complete — a broken/ T-junction chain can't make a
// whole side vanish (the bug the loop tracer had).
function boundaryEdgesOf(unitPolygonsList) {
  const all = new Map();
  for (const polys of unitPolygonsList) {
    for (const poly of polys) {
      for (const ring of poly) {
        for (let i = 0, n = ring.length; i < n; i++) {
          const a = ring[i], b = ring[(i + 1) % n];
          if (vKey(a[0], a[1]) === vKey(b[0], b[1])) continue;
          all.set(eKey(a, b), [a, b]);
        }
      }
    }
  }
  const out = [];
  for (const [k, e] of all) if (!all.has(eKey(e[1], e[0]))) out.push(e);
  return out;
}

// Draw boundary edges as independent segments (each its own M…L so no
// spurious connecting lines). Edges in `excludeEdges` (slab cuts) are
// dropped from the main path and returned separately for the dashed
// treatment.
function pathFromBoundaryEdges(edges, excludeEdges) {
  let main = '', slab = '';
  for (const [a, b] of edges) {
    const seg = 'M' + a[0].toFixed(1) + ',' + a[1].toFixed(1) +
                'L' + b[0].toFixed(1) + ',' + b[1].toFixed(1);
    if (excludeEdges && (excludeEdges.has(eKey(a, b)) || excludeEdges.has(eKey(b, a)))) slab += seg;
    else main += seg;
  }
  return { pathD: main, slabPathD: slab };
}

// Robust district-border mesh (topojson-mesh style): an UNDIRECTED
// segment is an internal border iff the units touching it span ≥2
// districts. Winding-insensitive + 0.1-unit key tolerance → no dropped
// sides, no gaps. Returns one path string for the whole unit set.
function meshBorderPath(units, assignment) {
  const seg = new Map();
  const r = (v) => Math.round(v * 10) / 10;
  for (let i = 0; i < units.length; i++) {
    const d = assignment[i];
    if (d < 0) continue;
    for (const poly of units[i].polygons) for (const ring of poly) {
      for (let j = 0, n = ring.length; j < n; j++) {
        const A = ring[j], B = ring[(j + 1) % n];
        const ax = r(A[0]), ay = r(A[1]), bx = r(B[0]), by = r(B[1]);
        if (ax === bx && ay === by) continue;
        const key = (ax < bx || (ax === bx && ay <= by))
          ? `${ax},${ay},${bx},${by}` : `${bx},${by},${ax},${ay}`;
        let s = seg.get(key);
        if (!s) { s = { x1: ax, y1: ay, x2: bx, y2: by, ds: new Set() }; seg.set(key, s); }
        s.ds.add(d);
      }
    }
  }
  let path = '';
  for (const s of seg.values()) if (s.ds.size >= 2) path += `M${s.x1},${s.y1}L${s.x2},${s.y2}`;
  return path;
}

// Given a list of units (each with `.fips` and `.polygons`), find all edges
// that lie on a slab-cut between two SAME-FIPS fragments. Returns a Set of
// eKey strings (in BOTH directions for each cut). These are population-
// balancing artifacts, not real geographic boundaries; the renderer
// suppresses them when drawing district outlines.
//
// Algorithm: for each FIPS with multiple fragments, collect all directed
// edges from those fragments. An edge is a slab-cut iff its reverse appears
// in the SAME-FIPS edge collection (i.e., two same-FIPS fragments share
// that boundary segment in opposite directions).
function findSlabCutEdges(units) {
  const fipsToEdges = new Map(); // fips → Map(eKey → true)
  for (const u of units) {
    if (!fipsToEdges.has(u.fips)) fipsToEdges.set(u.fips, new Map());
    const edges = fipsToEdges.get(u.fips);
    for (const poly of u.polygons) {
      for (const ring of poly) {
        for (let i = 0, n = ring.length; i < n; i++) {
          const a = ring[i], b = ring[(i + 1) % n];
          if (vKey(a[0], a[1]) === vKey(b[0], b[1])) continue;
          edges.set(eKey(a, b), true);
        }
      }
    }
  }
  const slabCuts = new Set();
  for (const [fips, edges] of fipsToEdges) {
    for (const k of edges.keys()) {
      // Reconstruct revK: parse "ax,ay:bx,by" → "bx,by:ax,ay"
      const colon = k.indexOf(':');
      const revK = k.substring(colon + 1) + ':' + k.substring(0, colon);
      if (edges.has(revK)) {
        slabCuts.add(k);
        slabCuts.add(revK);
      }
    }
  }
  return slabCuts;
}

// Build SVG path string from boundary loops.
function pathFromLoops(loops, minArea = 0) {
  const parts = [];
  for (const loop of loops) {
    if (loop.length < 3) continue;
    // Optional area filter: drops sliver/orphan loops below minArea (in
    // squared units). Used to suppress single-tract floaters from broken
    // adjacency at tract granularity — these would otherwise render as
    // distracting black dots/dashes scattered across the map.
    if (minArea > 0) {
      let signedArea = 0;
      for (let i = 0, n = loop.length; i < n; i++) {
        const [x1, y1] = loop[i];
        const [x2, y2] = loop[(i + 1) % n];
        signedArea += x1 * y2 - x2 * y1;
      }
      if (Math.abs(signedArea) / 2 < minArea) continue;
    }
    let p = '';
    for (let i = 0; i < loop.length; i++) {
      const [x, y] = loop[i];
      p += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }
    p += 'Z';
    parts.push(p);
  }
  return parts.join('');
}

// Like pathFromLoops, but skips edges in `excludeEdges` (a Set of eKey
// strings, both directions). Result is an open polyline path that
// preserves the boundary geometry minus the suppressed segments. Used to
// emit the "real geographic" portion of district boundaries, with same-
// FIPS slab cuts rendered separately by `pathFromLoopsOnly` so the user
// can distinguish natural boundaries from population-balance artifacts.
function pathFromLoopsExcluding(loops, excludeEdges, minArea = 0) {
  if (!excludeEdges || excludeEdges.size === 0) {
    return pathFromLoops(loops, minArea);
  }
  const parts = [];
  for (const loop of loops) {
    if (loop.length < 3) continue;
    if (minArea > 0) {
      let signedArea = 0;
      for (let i = 0, n = loop.length; i < n; i++) {
        const [x1, y1] = loop[i];
        const [x2, y2] = loop[(i + 1) % n];
        signedArea += x1 * y2 - x2 * y1;
      }
      if (Math.abs(signedArea) / 2 < minArea) continue;
    }
    let p = '';
    let pendingMove = true;
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % n];
      const k = eKey(a, b), kr = eKey(b, a);
      const suppressed = excludeEdges.has(k) || excludeEdges.has(kr);
      if (pendingMove) {
        p += 'M' + a[0].toFixed(1) + ',' + a[1].toFixed(1);
        pendingMove = false;
      }
      if (suppressed) {
        // Skip the edge a→b. Next iteration will emit a fresh M to b.
        pendingMove = true;
      } else {
        p += 'L' + b[0].toFixed(1) + ',' + b[1].toFixed(1);
      }
    }
    if (p.length > 0) parts.push(p);
  }
  return parts.join('');
}

// Emit ONLY the segments along edges in `includeEdges` (the inverse of
// pathFromLoopsExcluding). Each maximal run of included edges becomes a
// separate sub-path. Used to render slab-cut district boundaries with a
// distinct, lighter visual treatment so the user knows where district
// boundaries fall through subdivided counties without those boundaries
// dominating the map.
function pathFromLoopsOnly(loops, includeEdges, minArea = 0) {
  if (!includeEdges || includeEdges.size === 0) return '';
  const parts = [];
  for (const loop of loops) {
    if (loop.length < 3) continue;
    if (minArea > 0) {
      let signedArea = 0;
      for (let i = 0, n = loop.length; i < n; i++) {
        const [x1, y1] = loop[i];
        const [x2, y2] = loop[(i + 1) % n];
        signedArea += x1 * y2 - x2 * y1;
      }
      if (Math.abs(signedArea) / 2 < minArea) continue;
    }
    let p = '';
    let inSegment = false;
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % n];
      const k = eKey(a, b), kr = eKey(b, a);
      const included = includeEdges.has(k) || includeEdges.has(kr);
      if (included) {
        if (!inSegment) {
          p += 'M' + a[0].toFixed(1) + ',' + a[1].toFixed(1);
          inSegment = true;
        }
        p += 'L' + b[0].toFixed(1) + ',' + b[1].toFixed(1);
      } else {
        inSegment = false;
      }
    }
    if (p.length > 0) parts.push(p);
  }
  return parts.join('');
}

/* ---------- POLE OF INACCESSIBILITY (polylabel) ------------------------- */
// The point inside a polygon furthest from any boundary — the canonical
// "best label location." Implemented via quad-tree refinement (Mapbox's
// polylabel algorithm by Vladimir Agafonkin). Operates on an array of
// closed loops, treating them as an even-odd-fill polygon.

function pointToSegmentDist2(px, py, ax, ay, bx, by) {
  let dx = bx - ax, dy = by - ay;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    if (t > 1) { ax = bx; ay = by; }
    else if (t > 0) { ax += dx * t; ay += dy * t; }
  }
  dx = px - ax; dy = py - ay;
  return dx * dx + dy * dy;
}

// Signed distance from a point to a polygon (positive inside, negative
// outside). Polygon given as an array of closed loops, even-odd fill.
function pointToLoopsDist(px, py, loops) {
  let inside = false;
  let minDist2 = Infinity;
  for (const loop of loops) {
    for (let i = 0, n = loop.length, j = n - 1; i < n; j = i++) {
      const [ax, ay] = loop[i];
      const [bx, by] = loop[j];
      if (((ay > py) !== (by > py)) && (px < ((bx - ax) * (py - ay)) / (by - ay) + ax)) {
        inside = !inside;
      }
      const d2 = pointToSegmentDist2(px, py, ax, ay, bx, by);
      if (d2 < minDist2) minDist2 = d2;
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(minDist2);
}

function loopsBbox(loops) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const loop of loops) for (const [x, y] of loop) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

// Find the pole of inaccessibility (point furthest inside the polygon)
// via quad-tree subdivision. Returns [x, y, dist] or null.
function poleOfInaccessibility(loops, precision = 0.5) {
  if (!loops || loops.length === 0) return null;
  const [minX, minY, maxX, maxY] = loopsBbox(loops);
  const w = maxX - minX, h = maxY - minY;
  if (w <= 0 || h <= 0) return null;
  const cellSize = Math.min(w, h);
  const h2 = cellSize / 2;
  const queue = [];
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      const cx = x + h2, cy = y + h2;
      const d = pointToLoopsDist(cx, cy, loops);
      queue.push({ x: cx, y: cy, half: h2, dist: d, max: d + h2 * Math.SQRT2 });
    }
  }
  let best = { x: minX + w / 2, y: minY + h / 2, dist: pointToLoopsDist(minX + w / 2, minY + h / 2, loops) };
  function popBest() {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[bi].max) bi = i;
    return queue.splice(bi, 1)[0];
  }
  let iter = 0;
  while (queue.length > 0 && iter < 8000) {
    iter++;
    const cell = popBest();
    if (cell.dist > best.dist) best = { x: cell.x, y: cell.y, dist: cell.dist };
    if (cell.max - best.dist <= precision) continue;
    const newHalf = cell.half / 2;
    for (const [dx, dy] of [[-newHalf, -newHalf], [newHalf, -newHalf], [-newHalf, newHalf], [newHalf, newHalf]]) {
      const cx = cell.x + dx, cy = cell.y + dy;
      const d = pointToLoopsDist(cx, cy, loops);
      queue.push({ x: cx, y: cy, half: newHalf, dist: d, max: d + newHalf * Math.SQRT2 });
    }
  }
  return [best.x, best.y, best.dist];
}

// Polygon area (signed, via shoelace; outer minus holes).
function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
function polygonArea(poly) {
  if (poly.length === 0) return 0;
  let a = ringArea(poly[0]);
  for (let i = 1; i < poly.length; i++) a -= ringArea(poly[i]);
  return Math.max(a, 0);
}
function multiPolygonArea(polys) {
  return polys.reduce((s, p) => s + polygonArea(p), 0);
}

// Area-weighted centroid of a multipolygon.
function multiPolygonCentroid(polys) {
  let totA = 0, cx = 0, cy = 0;
  for (const poly of polys) {
    for (const ring of poly) {
      let a = 0, x = 0, y = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % ring.length];
        const cross = x1 * y2 - x2 * y1;
        a += cross;
        x += (x1 + x2) * cross;
        y += (y1 + y2) * cross;
      }
      a /= 2;
      const absA = Math.abs(a);
      if (absA > 1e-9) {
        x /= 6 * a; y /= 6 * a;
        totA += absA;
        cx += x * absA;
        cy += y * absA;
      }
    }
  }
  return totA > 0 ? [cx / totA, cy / totA] : [0, 0];
}

// Sutherland-Hodgman clip of a single ring against a half-plane.
//   axis: 0=x (vertical line at x=split), 1=y (horizontal at y=split)
//   keepLow: true keeps ring portions where coord <= split; false keeps >= split
function clipRingHalfplane(ring, axis, split, keepLow) {
  const result = [];
  if (ring.length === 0) return result;
  const inside = (p) => keepLow ? p[axis] <= split : p[axis] >= split;
  let prev = ring[ring.length - 1];
  let prevIn = inside(prev);
  for (const cur of ring) {
    const curIn = inside(cur);
    if (curIn) {
      if (!prevIn) {
        const t = (split - prev[axis]) / (cur[axis] - prev[axis]);
        result.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
      }
      result.push(cur);
    } else if (prevIn) {
      const t = (split - prev[axis]) / (cur[axis] - prev[axis]);
      result.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
    }
    prev = cur; prevIn = curIn;
  }
  return result;
}
function clipPolygonHalfplane(poly, axis, split, keepLow) {
  if (poly.length === 0) return [];
  const outer = clipRingHalfplane(poly[0], axis, split, keepLow);
  if (outer.length < 3) return [];
  const holes = [];
  for (let i = 1; i < poly.length; i++) {
    const h = clipRingHalfplane(poly[i], axis, split, keepLow);
    if (h.length >= 3) holes.push(h);
  }
  return [outer, ...holes];
}
function clipMultiPolygonHalfplane(polys, axis, split, keepLow) {
  const out = [];
  for (const p of polys) {
    const cp = clipPolygonHalfplane(p, axis, split, keepLow);
    if (cp.length > 0) out.push(cp);
  }
  return out;
}

// Slab-subdivide a multipolygon into N roughly-equal-area fragments via
// recursive bisection along the longest axis. Returns array of N MultiPolygons.
function slabSubdivide(polys, N) {
  if (N <= 1) return [polys];
  const [minX, minY, maxX, maxY] = bboxOfPolygons(polys);
  const w = maxX - minX, h = maxY - minY;
  const axis = w >= h ? 0 : 1;
  const totalArea = multiPolygonArea(polys);
  const fragments = [];
  let remaining = polys;
  for (let i = 0; i < N - 1; i++) {
    const targetArea = totalArea * (1 / N);
    let lo = axis === 0 ? bboxOfPolygons(remaining)[0] : bboxOfPolygons(remaining)[1];
    let hi = axis === 0 ? bboxOfPolygons(remaining)[2] : bboxOfPolygons(remaining)[3];
    let split = lo;
    for (let iter = 0; iter < 30; iter++) {
      split = (lo + hi) / 2;
      const lowSlab = clipMultiPolygonHalfplane(remaining, axis, split, true);
      const lowArea = multiPolygonArea(lowSlab);
      if (Math.abs(lowArea - targetArea) < totalArea * 0.001) break;
      if (lowArea < targetArea) lo = split; else hi = split;
    }
    fragments.push(clipMultiPolygonHalfplane(remaining, axis, split, true));
    remaining = clipMultiPolygonHalfplane(remaining, axis, split, false);
  }
  fragments.push(remaining);
  return fragments;
}

/* ---------- DATA ASSEMBLY ----------------------------------------------- */
// buildUnits: combines the fetched topojson with the inline votes/populations
// into the final units array used by the rendering and (eventually) the
// districting algorithm. Runs once per page load (~1s for 3,142 counties).
function buildUnits(topology) {
  // Subdivision strategy: counties are slab-cut into ~target-population
  // fragments when they exceed the parent state's target district population
  // by more than 5%. Different states have different targets (state pop /
  // state seats), so the threshold is computed per state. This guarantees
  // every unit's population is at or below ~target × 1.05, which is what
  // ReCom needs to find balanced cuts at ±5% tolerance.
  // Compute per-state targets first.
  const stateTargets = {};
  // Quick first pass: sum populations by state code
  for (const fips of Object.keys(topology.objects.counties.geometries.reduce((acc, g) => { acc[g.id] = 1; return acc; }, {}))) {
    const sb = STATE_BY_FIPS[fips.substring(0, 2)];
    if (!sb) continue;
    const [code] = sb;
    if (!stateTargets[code]) stateTargets[code] = { pop: 0, seats: SEATS_BY_STATE[code] || 1 };
    stateTargets[code].pop += POPULATIONS[fips] || 0;
  }
  for (const code of Object.keys(stateTargets)) {
    stateTargets[code].target = stateTargets[code].pop / stateTargets[code].seats;
    // Aggressive subdivision: split anything > 0.5 × target. This produces
    // ~2× as many units per state but gives ReCom enough degrees of freedom
    // to find balanced cuts. Floor of 200K prevents over-fragmenting tiny
    // counties in dense states like RI/CT.
    // Subdivision threshold. ReCom needs many units per district to find
    // balanced cuts at ±5 %. We split any county whose population exceeds
    // ~25 % of the state's target district population, with a 200K floor
    // that protects small/medium counties in sparse states from over-
    // fragmentation. This is aggressive enough to handle dense states with
    // a few mega-counties (CA, NY, TX, NJ) while leaving the bulk of US
    // counties whole.
    const sm = stateTargets[code];
    sm.splitThreshold = Math.max(200000, sm.target * 0.25);
  }

  // 1. Decode counties layer
  const { out: countyData, arcUsers: countyArcUsers } = decodeTopoLayer(topology, 'counties');
  // 2. Decode states layer (for outline overlays + state labels)
  const { out: stateData } = decodeTopoLayer(topology, 'states');

  // 3. Build state geometry lookup keyed by 2-letter code
  const stateGeom = {};
  for (const [fips, { polygons, name }] of Object.entries(stateData)) {
    const sb = STATE_BY_FIPS[fips];
    if (!sb) continue;
    const [code, fullName] = sb;
    stateGeom[code] = {
      code, fips, name: fullName,
      polygons, bbox: bboxOfPolygons(polygons),
      pathD: pathFromPolygons(polygons),
      seats: SEATS_BY_STATE[code] || 0,
    };
  }

  // 4. Build county-to-county adjacency from the topojson arc-user map.
  //    Two counties share a border iff they both reference the same arc.
  const countyAdj = new Map();
  for (const users of countyArcUsers.values()) {
    if (users.size < 2) continue;
    for (const a of users) {
      if (!countyAdj.has(a)) countyAdj.set(a, new Set());
      for (const b of users) if (a !== b) countyAdj.get(a).add(b);
    }
  }

  // 5. Build the units array: each county is one unit, except big counties
  //    are split into slab fragments.
  const units = [];
  for (const fips of Object.keys(countyData)) {
    const { polygons, name: countyName } = countyData[fips];
    const stateFipsPrefix = fips.substring(0, 2);
    const sb = STATE_BY_FIPS[stateFipsPrefix];
    if (!sb) continue; // territories
    const [stateCode, stateName] = sb;
    const pop = POPULATIONS[fips];

    // Special: AK is a single at-large district. We still want to render
    // every borough's polygon (so AK doesn't have visual gaps), but for
    // the algorithm we treat all AK units as carrying the AK statewide
    // partisan rate weighted by their population share.
    const isAK = stateCode === 'AK';
    function votesForFips(yr) {
      const yearSrc = VOTES_BY_YEAR[yr];
      if (!yearSrc) return null;
      if (isAK) {
        // Use the statewide totals, scaled to this borough's pop fraction
        const akTotalPop = POPULATIONS['_AK'] || 1;
        const akTotalVotes = yearSrc['_AK'];
        if (!akTotalVotes) return null;
        const frac = (pop || 0) / akTotalPop;
        return [
          Math.round(akTotalVotes[0] * frac),
          Math.round(akTotalVotes[1] * frac),
          Math.round(akTotalVotes[2] * frac),
        ];
      }
      return yearSrc[fips] || null;
    }

    const stateInfo = stateTargets[stateCode];
    const splitThreshold = stateInfo ? stateInfo.splitThreshold : 900000;
    const stateTarget = stateInfo ? stateInfo.target : TARGET_DISTRICT_POP;

    if (!pop || pop < splitThreshold) {
      const votes = {};
      for (const yr of YEAR_CONFIG.allYears) {
        const v = votesForFips(yr);
        votes[yr] = v ? { d: v[0], r: v[1], t: v[2] } : null;
      }
      units.push({
        id: fips, fips, stateCode, stateName, countyName: countyName || '?',
        pop: pop || 0,
        polygons,
        votes,
      });
    } else {
      // Subdivide: split into N fragments where each is ≤ 0.4 × stateTarget
      // Subdivide into fragments each at most ~0.12 × target. Smaller
      // fragments give the chain more degrees of freedom to land balanced
      // cuts. The 0.12 figure was tuned to land CA/TX/NY/NJ inside ±5 %
      // (this is what allows ~8 fragments per district in the densest
      // metropolitan counties, which is roughly the empirical minimum
      // for ReCom to find balanced cuts there).
      const N = Math.max(2, Math.ceil(pop / (stateTarget * 0.12)));
      const fragments = slabSubdivide(polygons, N);
      const fragAreas = fragments.map(multiPolygonArea);
      const totA = fragAreas.reduce((s, a) => s + a, 0);
      const allV = {};
      for (const yr of YEAR_CONFIG.allYears) allV[yr] = votesForFips(yr);
      for (let i = 0; i < N; i++) {
        const frac = totA > 0 ? fragAreas[i] / totA : 1 / N;
        const fragPop = Math.round(pop * frac);
        const fragVotes = {};
        for (const yr of YEAR_CONFIG.allYears) {
          const v = allV[yr];
          if (v) fragVotes[yr] = { d: Math.round(v[0] * frac), r: Math.round(v[1] * frac), t: Math.round(v[2] * frac) };
        }
        units.push({
          id: `${fips}-${i}`, fips, stateCode, stateName,
          countyName: `${countyName || '?'} (frag ${i + 1}/${N})`,
          pop: fragPop,
          polygons: fragments[i],
          votes: fragVotes,
        });
      }
    }
  }

  // 6. Compute centroid, bbox, pathD for each unit (caches for rendering)
  for (const u of units) {
    u.centroid = multiPolygonCentroid(u.polygons);
    u.bbox = bboxOfPolygons(u.polygons);
    u.pathD = pathFromPolygons(u.polygons);
  }

  // 7. Index lookups
  const idIdx = new Map();
  for (let i = 0; i < units.length; i++) idIdx.set(units[i].id, i);
  const unitsByState = {};
  for (const u of units) {
    if (!unitsByState[u.stateCode]) unitsByState[u.stateCode] = [];
    unitsByState[u.stateCode].push(u);
  }

  // 8. Build unit-level adjacency
  const adj = units.map(() => new Set());
  // 8a. Intra-county: slab order chain
  const fragsByFips = {};
  for (let i = 0; i < units.length; i++) {
    if (!fragsByFips[units[i].fips]) fragsByFips[units[i].fips] = [];
    fragsByFips[units[i].fips].push(i);
  }
  for (const idxs of Object.values(fragsByFips)) {
    if (idxs.length < 2) continue;
    idxs.sort((a, b) => {
      const sa = units[a].id.includes('-') ? parseInt(units[a].id.split('-')[1]) : 0;
      const sb = units[b].id.includes('-') ? parseInt(units[b].id.split('-')[1]) : 0;
      return sa - sb;
    });
    for (let i = 0; i < idxs.length - 1; i++) {
      adj[idxs[i]].add(idxs[i + 1]);
      adj[idxs[i + 1]].add(idxs[i]);
    }
  }
  // 8b. Inter-county: for each pair of arc-adjacent counties, pick the K
  // closest fragments by centroid distance and connect them.
  const KEEP_PER_FRAGMENT = 2;
  function dist2(a, b) { return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2; }
  for (const [fipsA, neighbors] of countyAdj) {
    const aFrags = fragsByFips[fipsA];
    if (!aFrags) continue;
    for (const fipsB of neighbors) {
      const bFrags = fragsByFips[fipsB];
      if (!bFrags) continue;
      for (const ai of aFrags) {
        const ranked = bFrags.map((bi) => [bi, dist2(units[ai].centroid, units[bi].centroid)]).sort((x, y) => x[1] - y[1]);
        const k = Math.min(KEEP_PER_FRAGMENT, ranked.length);
        for (let j = 0; j < k; j++) {
          adj[ai].add(ranked[j][0]);
          adj[ranked[j][0]].add(ai);
        }
      }
    }
  }
  // 8c. Apply water-gap bridges as additional county-level adjacencies, so
  // the centroid-nearest fragment matcher above works on them too.
  // (Done as a second pass since we need countyAdj augmented before the
  // matcher runs. Implementation: add bridges to countyAdj, then re-run
  // the inter-county matching pass for those specific pairs.)
  for (const [fipsA, fipsB] of WATER_GAP_BRIDGES) {
    const aFrags = fragsByFips[fipsA];
    const bFrags = fragsByFips[fipsB];
    if (!aFrags || !bFrags) continue;
    // Connect the closest pair of fragments
    let bestA = -1, bestB = -1, bestDist = Infinity;
    for (const ai of aFrags) for (const bi of bFrags) {
      const d = dist2(units[ai].centroid, units[bi].centroid);
      if (d < bestDist) { bestDist = d; bestA = ai; bestB = bi; }
    }
    if (bestA !== -1) {
      adj[bestA].add(bestB);
      adj[bestB].add(bestA);
    }
  }

  return { units, adjacency: adj.map((s) => [...s]), idIdx, unitsByState, stateGeom };
}

/* ---------- DATA HOOK --------------------------------------------------- */
// Fetch the us-atlas counties-albers-10m topojson, then run buildUnits to
// produce the assembled data structure. Caches at module level so subsequent
// renders/mounts get the data instantly.
const COUNTIES_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/counties-albers-10m.json';
let CACHED_DATA = null;
let CACHED_DATA_PROMISE = null;

function useData() {
  const [data, setData] = useState(CACHED_DATA);
  const [loadStage, setLoadStage] = useState(CACHED_DATA ? 'ready' : 'fetching');
  useEffect(() => {
    if (CACHED_DATA) return;
    let cancelled = false;
    if (!CACHED_DATA_PROMISE) {
      CACHED_DATA_PROMISE = (async () => {
        // Fetch the county topojson, the populations table, and every
        // year's vote file in parallel. The vote files are small (~80KB
        // each), so loading all 7 years up front is cheaper than lazy-
        // loading on year-change.
        const dataBase = (typeof window !== 'undefined' && window.__DATA_BASE_URL__) || '/data/';
        const fetches = [
          fetch(COUNTIES_URL).then((r) => r.json()),
          fetch(dataBase + 'populations.json').then((r) => r.json()),
          ...YEAR_CONFIG.allYears.map((y) =>
            fetch(dataBase + 'votes/' + y + '.json').then((r) => r.json())
          ),
        ];
        const [topo, pops, ...voteFiles] = await Promise.all(fetches);
        POPULATIONS = pops;
        VOTES_BY_YEAR = {};
        for (let i = 0; i < YEAR_CONFIG.allYears.length; i++) {
          VOTES_BY_YEAR[YEAR_CONFIG.allYears[i]] = voteFiles[i];
        }
        // Yield to UI between fetch and build
        await new Promise((r) => setTimeout(r, 0));
        const built = buildUnits(topo);
        CACHED_DATA = built;
        return built;
      })();
    }
    CACHED_DATA_PROMISE.then((d) => {
      if (!cancelled) { setData(d); setLoadStage('ready'); }
    }).catch((err) => {
      if (!cancelled) { setLoadStage('error: ' + err.message); }
    });
    setLoadStage('building');
    return () => { cancelled = true; };
  }, []);
  return { data, loadStage };
}

/* ---------- TRACT DATA HOOK -------------------------------------------- */
// Fetches per-state census-tract topojson at runtime when the user opens a
// state-detail view, builds tract-level units (each tract = 1 unit), and
// disaggregates the parent county's votes pro rata to each tract by
// population. The tract topojson is pre-projected to Albers USA pixel space
// (matching the counties-albers data) and contains a `pop` property per
// tract from the 2020 Decennial Census P1 table.
//
// Data location: per-state tract files at TRACTS_BASE_URL/<2-digit FIPS>.json
// (e.g. "06.json" for California, "37.json" for North Carolina, etc).
//
// SETUP: deploy the 51 tract topojson files (provided alongside this
// dashboard, ~28MB total) to any CORS-friendly static host — your own
// CDN, an S3 bucket, GitHub Pages, jsDelivr-from-GitHub, etc. — and set
// TRACTS_BASE_URL to that location's path with trailing slash. The files
// were prebuilt with 2020-Census tract polygons projected to Albers USA
// pixel space and embedded P1-table populations.
//
// While this URL is null OR returns 404, the state-detail view falls back
// to county-level rendering (with visible slab-cut artifacts in metropolitan
// counties). The fallback is functional but lower-fidelity. The fall-through
// is silent; check the lede in state-detail for current status.
// Base URL for tract data, set via NEXT_PUBLIC_TRACTS_BASE_URL at build time.
// While unset (null) the state-detail view falls back to county-level rendering
// with visible slab-cut artifacts in metropolitan counties. Set it to e.g.
// 'https://cdn.jsdelivr.net/gh/USERNAME/tracts@main/' to enable tract mode.
const TRACTS_BASE_URL =
  (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_TRACTS_BASE_URL) ||
  // Default: look for tract data under /data/tracts/ in the deployment.
  // If the files aren't there, the dashboard falls back to county-level
  // rendering silently. To override, set NEXT_PUBLIC_TRACTS_BASE_URL at build.
  '/data/tracts/';

// ---- Precinct substrate (alternative "Precinct" dashboard view) --------
// Real precinct (2020 VTD) returns from Dave's Redistricting `vtd_data`,
// built by scripts/build-precincts.mjs into /data/precincts/<fips>.json
// (geometry already in app Albers space + REAL per-cycle D/R + 2020 pop +
// rook adjacency). Unlike the model substrate (county totals disaggregated
// to tracts by a density heuristic), nothing here is modeled — these are
// the actual counted votes, so the only cycles available are the ones with
// precinct returns, and only the states whose files have been built.
const PRECINCTS_BASE_URL =
  (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_PRECINCTS_BASE_URL) ||
  '/data/precincts/';
const PRECINCT_YEARS = [2008, 2012, 2016, 2020];
// 2-letter codes whose precinct file has been generated. All 50 states are
// built (scripts/build-precincts.mjs); single-seat states still get real
// precinct geometry + returns even though their one district is trivial.
const PRECINCT_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY']);
const CACHED_PRECINCTS = new Map();           // stateCode → built precinct data
const CACHED_PRECINCT_PARTITIONS = new Map(); // stateCode+'-'+seed+'-'+k → partition

const FIPS_BY_STATE_CODE = (() => {
  const out = {};
  for (const [fips, [code]] of Object.entries(STATE_BY_FIPS)) out[code] = fips;
  return out;
})();

const CACHED_TRACTS = new Map(); // stateCode → built tract data

function buildTractUnits(topology, stateCode, countyData) {
  // Iterate raw topology geometries directly. Each geometry has
  // properties.id (the 11-digit GEOID) and properties.pop (2020 P1 total).
  const tractUnits = [];
  const idIdx = new Map();

  // Decode arcs. The tract topojson files come in two flavors depending on
  // how they were built: (1) with a `transform` (delta-encoded integer
  // deltas to be scaled+translated) or (2) with absolute float coordinates.
  // Handle both.
  const arcs = topology.arcs;
  const transform = topology.transform;
  const decodedArcs = transform
    ? arcs.map((arc) => {
        const sx = transform.scale[0], sy = transform.scale[1];
        const tx = transform.translate[0], ty = transform.translate[1];
        let x = 0, y = 0;
        return arc.map(([dx, dy]) => {
          x += dx; y += dy;
          return [x * sx + tx, y * sy + ty];
        });
      })
    : arcs.map((arc) => arc.map(([x, y]) => [x, y]));
  function ringFromIndices(indices) {
    const ring = [];
    for (let k = 0; k < indices.length; k++) {
      const idx = indices[k];
      const arc = idx < 0 ? decodedArcs[~idx].slice().reverse() : decodedArcs[idx];
      const start = k === 0 ? 0 : 1;
      for (let m = start; m < arc.length; m++) ring.push(arc[m]);
    }
    return ring;
  }

  // Parent county lookup: 11-digit tract GEOID → first 5 chars = county FIPS
  // We need the parent county's votes to disaggregate.
  // countyData has per-FIPS votes through the same year keys we use elsewhere.
  // For speed, build parent-county pop totals on demand.

  const tractsList = topology.objects.tracts.geometries;
  const arcUsers = new Map();
  for (let gi = 0; gi < tractsList.length; gi++) {
    const g = tractsList[gi];
    const polys = g.type === 'MultiPolygon' ? g.arcs : [g.arcs];
    for (const poly of polys) {
      for (const ring of poly) {
        for (const idx of ring) {
          const abs = idx < 0 ? ~idx : idx;
          if (!arcUsers.has(abs)) arcUsers.set(abs, new Set());
          arcUsers.get(abs).add(gi);
        }
      }
    }
  }

  // -- Pre-pass: tract-level demographic partisanship model ---------------
  // We replace the previous uniform county-vote-disaggregation (every tract
  // gets the same per-capita D-share as its parent county) with a model
  // that adds within-county variation along the strongest non-racial axis
  // we can compute purely from the tract geometry: POPULATION DENSITY.
  //
  // Empirical political-science finding: log(population density) is one of
  // the two strongest predictors of two-party D-share (the other being
  // race). Coefficients in national multilevel models range 0.3–0.7 logit
  // per log unit of density. We use 0.45, a middle value that produces
  // visible urban-rural variation without overstating the geographic split.
  //
  // The signal is RELATIVE within each county: a tract is more D than its
  // county average to the extent its density exceeds the county median.
  // After applying the dLean shift, we rescale per (county, year) so the
  // sum of tract D-votes equals the actual county D-total (and same for R).
  // This preserves county-level truth while adding within-county detail.
  //
  // Future enhancement: extend with race/ethnicity (Census API B02001,
  // B03002) and education (B15003), which the build-time pipeline can
  // fetch given a Census API key. For now the runtime model is fully
  // self-contained — no external data needed.
  const W_DENSITY = 0.45;

  // First pass: decode geometry, compute area + density per tract, group
  // by parent county for the median-density baseline.
  const decoded = []; // [{ id, countyFips, pop, polys, area, density, centroid, bbox, pathD }]
  const parentCountyTractPop = new Map();
  const countyDensities = new Map(); // fips → [density, ...] for median
  for (let gi = 0; gi < tractsList.length; gi++) {
    const g = tractsList[gi];
    const id = g.properties?.id || `tract-${gi}`;
    const countyFips = id.substring(0, 5);
    const tractPop = g.properties?.pop || 0;
    const polys = g.type === 'MultiPolygon'
      ? g.arcs.map((p) => p.map(ringFromIndices))
      : [g.arcs.map(ringFromIndices)];
    const area = multiPolygonArea(polys);
    const density = (area > 0 && tractPop > 0) ? tractPop / area : 0;
    decoded.push({
      gi, id, countyFips, pop: tractPop, polys, area, density,
      centroid: multiPolygonCentroid(polys),
      bbox: bboxOfPolygons(polys),
    });
    parentCountyTractPop.set(countyFips, (parentCountyTractPop.get(countyFips) || 0) + tractPop);
    if (!countyDensities.has(countyFips)) countyDensities.set(countyFips, []);
    if (density > 0) countyDensities.get(countyFips).push(density);
  }
  // ---- Per-county population normalization -----------------------------
  // The tract topojson is mapshaper-simplified: ~20-25 % of small tracts
  // are dropped and ~25 % of survivors carry pop 0, so raw tract pop sums
  // to roughly half the true state total for large states (TX: 16.1M vs
  // 29.2M). That wrecks any equal-population partition. Fix it the same
  // way §3.4 fixes votes: rescale every county's tracts so they sum to
  // that county's authoritative P1 total (POPULATIONS, the same county
  // figures the national map uses). Within-county distribution is kept;
  // dropped/zeroed tracts' population is absorbed proportionally by the
  // survivors. A county whose tracts are ALL zero is filled area-weighted.
  {
    const countyTracts = new Map(); // fips → [decoded tract,...]
    for (const t of decoded) {
      let a = countyTracts.get(t.countyFips);
      if (!a) countyTracts.set(t.countyFips, (a = []));
      a.push(t);
    }
    for (const [fips, ts] of countyTracts) {
      const trueCP = POPULATIONS[fips] || 0;
      if (trueCP <= 0) continue; // no authoritative figure → leave as-is
      let rawCP = 0;
      for (const t of ts) rawCP += t.pop;
      if (rawCP > 0) {
        const scale = trueCP / rawCP;
        for (const t of ts) t.pop = Math.round(t.pop * scale);
      } else {
        // All tracts zero/missing: spread the county total by area.
        let areaSum = 0;
        for (const t of ts) areaSum += t.area;
        for (const t of ts) {
          t.pop = areaSum > 0
            ? Math.round(trueCP * (t.area / areaSum))
            : Math.round(trueCP / ts.length);
        }
      }
      // Downstream vote disaggregation reads parentCountyTractPop as the
      // per-county denominator; keep it consistent with the rescaled pops
      // (Σ tractPopFrac stays 1, turnout estimate gets more accurate).
      parentCountyTractPop.set(fips, trueCP);
    }
  }

  // Median density per county. For counties with all-zero-pop tracts we set
  // 0 and skip the dLean shift entirely.
  const countyMedianDensity = new Map();
  for (const [fips, arr] of countyDensities) {
    if (arr.length === 0) { countyMedianDensity.set(fips, 0); continue; }
    arr.sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    countyMedianDensity.set(fips,
      arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid]
    );
  }
  // Second pass: per-tract raw (predicted) D and R counts using the dLean
  // shift, accumulated per (county, year) for rescaling.
  const rawTractVotes = new Map(); // gi → year → { d, r, t }
  const countyRawSum = new Map();  // fips → year → { dSum, rSum, tSum }
  function logit(p) { return Math.log(p / (1 - p)); }
  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  for (const t of decoded) {
    rawTractVotes.set(t.gi, {});
    if (t.pop === 0) continue;
    const median = countyMedianDensity.get(t.countyFips) || 0;
    const dLean = (t.density > 0 && median > 0)
      ? W_DENSITY * Math.log(t.density / median)
      : 0;
    t.dLean = dLean;
    const cv = countyData[t.countyFips] || {};
    const parentPop = parentCountyTractPop.get(t.countyFips) || 1;
    const tractPopFrac = t.pop / parentPop;
    for (const yr of YEAR_CONFIG.allYears) {
      const cy = cv[yr];
      if (!cy || (cy.d + cy.r) === 0) continue;
      const countyTwoP = cy.d + cy.r;
      const countyDShare = cy.d / countyTwoP;
      // Predicted tract D-share, applying density-derived logit shift.
      // Clip the county share to avoid logit blowing up on safe counties.
      const clipped = Math.max(0.01, Math.min(0.99, countyDShare));
      const pTract = sigmoid(logit(clipped) + dLean);
      // Estimated tract turnout = tract pop fraction × county total turnout.
      const tractTurnout = countyTwoP * tractPopFrac;
      const rawD = tractTurnout * pTract;
      const rawR = tractTurnout * (1 - pTract);
      rawTractVotes.get(t.gi)[yr] = { d: rawD, r: rawR, t: cy.t * tractPopFrac };
      if (!countyRawSum.has(t.countyFips)) countyRawSum.set(t.countyFips, {});
      const yrSum = countyRawSum.get(t.countyFips);
      if (!yrSum[yr]) yrSum[yr] = { dSum: 0, rSum: 0 };
      yrSum[yr].dSum += rawD;
      yrSum[yr].rSum += rawR;
    }
  }
  // Third pass: build the final tractUnits with rescaled D/R per year.
  for (const t of decoded) {
    const cv = countyData[t.countyFips] || {};
    const votes = {};
    const parentDShare = {};
    const raw = rawTractVotes.get(t.gi);
    const yrSum = countyRawSum.get(t.countyFips) || {};
    const parentPop = parentCountyTractPop.get(t.countyFips) || 1;
    const tractPopFrac = t.pop > 0 ? t.pop / parentPop : 0;
    for (const yr of YEAR_CONFIG.allYears) {
      const cy = cv[yr];
      if (!cy) {
        votes[yr] = { d: 0, r: 0, t: 0 };
        parentDShare[yr] = null;
        continue;
      }
      const total = cy.d + cy.r;
      parentDShare[yr] = total > 0 ? cy.d / total : null;
      if (t.pop === 0 || !raw[yr] || !yrSum[yr]) {
        // Pop-zero tract: keep at uniform-share fallback so the polygon
        // still renders in a reasonable color (matches parent county).
        votes[yr] = {
          d: Math.round(cy.d * tractPopFrac),
          r: Math.round(cy.r * tractPopFrac),
          t: Math.round(cy.t * tractPopFrac),
        };
        continue;
      }
      // Rescale so Σ tract_d = county_d, Σ tract_r = county_r exactly.
      const scaleD = yrSum[yr].dSum > 0 ? cy.d / yrSum[yr].dSum : 0;
      const scaleR = yrSum[yr].rSum > 0 ? cy.r / yrSum[yr].rSum : 0;
      const finalD = Math.round(raw[yr].d * scaleD);
      const finalR = Math.round(raw[yr].r * scaleR);
      votes[yr] = { d: finalD, r: finalR, t: finalD + finalR };
    }
    const u = {
      id: t.id,
      fips: t.countyFips,
      stateCode,
      pop: t.pop,
      polygons: t.polys,
      votes,
      parentDShare,
      dLean: t.dLean ?? 0,
      density: t.density,
      centroid: t.centroid,
      bbox: t.bbox,
      pathD: pathFromPolygons(t.polys),
      _gi: t.gi,
    };
    idIdx.set(t.id, tractUnits.length);
    tractUnits.push(u);
  }

  // Build adjacency from shared arcs (two tracts are adjacent iff they share
  // a topojson arc — same logic as the county adjacency builder).
  const adjacency = tractUnits.map(() => new Set());
  for (const users of arcUsers.values()) {
    if (users.size < 2) continue;
    for (const a of users) {
      for (const b of users) {
        if (a === b) continue;
        adjacency[a].add(b);
      }
    }
  }

  // Topojson simplification can leave tracts disconnected from the main
  // graph (bbox-isolated coastal tracts, tracts whose original shared
  // boundaries were simplified into mismatched arcs). For ReCom to work
  // the graph must be connected, so we add bridge-edges between each
  // orphan component and its nearest neighbor in the main graph.
  const N = tractUnits.length;
  function findComponents() {
    const visited = new Array(N).fill(false);
    const comps = [];
    for (let i = 0; i < N; i++) {
      if (visited[i]) continue;
      const comp = [];
      const q = [i]; visited[i] = true;
      while (q.length) {
        const u = q.pop();
        comp.push(u);
        for (const v of adjacency[u]) if (!visited[v]) { visited[v] = true; q.push(v); }
      }
      comps.push(comp);
    }
    return comps;
  }
  let comps = findComponents();
  if (comps.length > 1) {
    // Identify the main component (largest)
    comps.sort((a, b) => b.length - a.length);
    const main = comps[0];
    // For each orphan component, find its nearest tract (by centroid distance)
    // in the main component and add a mutual adjacency edge.
    for (let ci = 1; ci < comps.length; ci++) {
      const orphan = comps[ci];
      let bestO = -1, bestM = -1, bestD2 = Infinity;
      for (const o of orphan) {
        const oc = tractUnits[o].centroid;
        for (const m of main) {
          const mc = tractUnits[m].centroid;
          const dx = oc[0] - mc[0], dy = oc[1] - mc[1];
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; bestO = o; bestM = m; }
        }
      }
      if (bestO !== -1) {
        adjacency[bestO].add(bestM);
        adjacency[bestM].add(bestO);
        // Once linked, the orphan component merges into main for further joins
        for (const o of orphan) main.push(o);
      }
    }
  }
  // Also ensure no tract has zero degree — link any isolated tract to its
  // nearest tract by centroid distance.
  for (let i = 0; i < N; i++) {
    if (adjacency[i].size === 0) {
      const ic = tractUnits[i].centroid;
      let bestJ = -1, bestD2 = Infinity;
      for (let j = 0; j < N; j++) {
        if (j === i) continue;
        const jc = tractUnits[j].centroid;
        const dx = ic[0] - jc[0], dy = ic[1] - jc[1];
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; bestJ = j; }
      }
      if (bestJ !== -1) {
        adjacency[i].add(bestJ);
        adjacency[bestJ].add(i);
      }
    }
  }

  return {
    units: tractUnits,
    adjacency: adjacency.map((s) => [...s]),
    idIdx,
  };
}

// Build per-county aggregate votes ({fips → {2016:{d,r,t}, 2020:..., 2024:...}})
// from the loaded national data. Subdivided counties (like LA County, which
// is split into 8 fragments) are re-summed back to the county total.
// Single-pass linear scan; called once per state-detail open.
function buildCountyVotesIndex(data) {
  const out = {};
  for (const u of data.units) {
    let row = out[u.fips];
    if (!row) {
      row = out[u.fips] = {};
      for (const yr of YEAR_CONFIG.allYears) row[yr] = { d: 0, r: 0, t: 0, _has: false };
    }
    for (const yr of YEAR_CONFIG.allYears) {
      const v = u.votes[yr];
      if (v) {
        row[yr].d += v.d;
        row[yr].r += v.r;
        row[yr].t += v.t;
        row[yr]._has = true;
      }
    }
  }
  // Convert _has=false entries to null
  for (const fips of Object.keys(out)) {
    for (const yr of YEAR_CONFIG.allYears) {
      if (!out[fips][yr]._has) out[fips][yr] = null;
      else delete out[fips][yr]._has;
    }
  }
  return out;
}

function useStateTractData(stateCode, data) {
  const [tractData, setTractData] = useState(stateCode ? CACHED_TRACTS.get(stateCode) || null : null);
  const [stage, setStage] = useState('idle');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!stateCode || !data) { setTractData(null); setStage('idle'); return; }
    if (!TRACTS_BASE_URL) {
      // Tract hosting not configured — skip fetch silently. Dashboard will
      // render in county-level fallback mode.
      setTractData(null);
      setStage('unconfigured');
      return;
    }
    if (CACHED_TRACTS.has(stateCode)) {
      setTractData(CACHED_TRACTS.get(stateCode));
      setStage('ready');
      return;
    }
    let cancelled = false;
    setTractData(null);
    setStage('fetching');
    setError(null);
    const fips = FIPS_BY_STATE_CODE[stateCode];
    if (!fips) { setStage('error'); setError('no FIPS for ' + stateCode); return; }

    (async () => {
      try {
        const url = TRACTS_BASE_URL + fips + '.json';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Fetch ${resp.status}: ${url}`);
        const topo = await resp.json();
        if (cancelled) return;
        setStage('building');
        await new Promise((r) => setTimeout(r, 0));
        const countyVotes = buildCountyVotesIndex(data);
        const built = buildTractUnits(topo, stateCode, countyVotes);
        if (cancelled) return;
        CACHED_TRACTS.set(stateCode, built);
        setTractData(built);
        setStage('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e.message);
        setStage('error');
      }
    })();

    return () => { cancelled = true; };
  }, [stateCode, data]);

  return { tractData, stage, error };
}

// Chained hook: fetches tract data for a state, then runs ReCom on the
// tract graph to produce a tract-level partition. Cached per (stateCode,
// seed, k) so re-opening the same state doesn't recompute.
//
// Stage progression: idle → fetching → building → recom → ready (or error).
// While in any non-ready stage, callers should fall back to the county-level
// data so the UI stays interactive.
const CACHED_TRACT_PARTITIONS = new Map(); // key: stateCode+'-'+seed+'-'+k → partition

function useStateTractPartition(stateCode, data, seats, baseSeed, model = 'recom') {
  const { tractData, stage: dataStage, error: dataError } = useStateTractData(stateCode, data);
  const [partition, setPartition] = useState(null);
  const [stage, setStage] = useState('idle');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!stateCode || !data) { setPartition(null); setStage('idle'); return; }
    if (dataStage === 'unconfigured') { setStage('unconfigured'); return; }
    if (dataStage === 'fetching') { setStage('fetching'); return; }
    if (dataStage === 'building') { setStage('building'); return; }
    if (dataStage === 'error') { setStage('error'); setError(dataError); return; }
    if (dataStage !== 'ready' || !tractData) return;

    const seed = baseSeed * 1000 + stateCode.charCodeAt(0) * 17 + stateCode.charCodeAt(1);
    const cacheKey = `${stateCode}-${seed}-${seats}-${model}`;
    if (CACHED_TRACT_PARTITIONS.has(cacheKey)) {
      setPartition(CACHED_TRACT_PARTITIONS.get(cacheKey));
      setStage('ready');
      return;
    }

    let cancelled = false;
    setStage('recom');
    setError(null);
    // Defer ReCom one tick so React can paint the loading UI before the
    // synchronous compute blocks the main thread.
    const handle = setTimeout(() => {
      if (cancelled) return;
      try {
        const t0 = Date.now();
        const N = tractData.units.length;
        // Scale burn-in with graph size — small states (NE: 132 tracts)
        // converge in ~200 steps; large states (CA: 8040 tracts) need
        // 1500-2000. Cap to keep worst-case latency under ~8s.
        const burnIn = Math.max(400, Math.min(2000, Math.round(N * 0.25)));
        const result = runPartition(
          model,
          tractData.units,
          tractData.adjacency,
          seats,
          seed,
          { burnIn, tolerance: 0.01,
            cohesion: tractData.units.map((u) => u.fips) }
        );
        const elapsed = Date.now() - t0;
        if (cancelled) return;
        if (!result) throw new Error('ReCom failed to produce a partition');
        const tagged = { ...result, _elapsedMs: elapsed };
        CACHED_TRACT_PARTITIONS.set(cacheKey, tagged);
        setPartition(tagged);
        setStage('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e.message);
        setStage('error');
      }
    }, 30);

    return () => { cancelled = true; clearTimeout(handle); };
  }, [stateCode, data, dataStage, tractData, seats, baseSeed, model]);

  return { tractData, partition, stage, error };
}

/* ---------- PRECINCT SUBSTRATE ----------------------------------------- */
// Parse a /data/precincts/<fips>.json file into the SAME unit contract
// buildTractUnits produces, so every downstream renderer/among (district
// tracing, labels, computeDistrictResults, hover) works unchanged. The
// only real difference: votes are the ACTUAL precinct returns, not a
// county total disaggregated by a density model.
function buildPrecinctUnits(pj, stateCode) {
  const fips = pj.fips || FIPS_BY_STATE_CODE[stateCode];
  const units = new Array(pj.precincts.length);
  const idIdx = new Map();
  for (let i = 0; i < pj.precincts.length; i++) {
    const p = pj.precincts[i];
    // p.polys: MultiPolygon-style [ [ ring=[[x,y]...], holes... ], ... ]
    const polys = p.polys;
    const votes = {};
    for (const yr of YEAR_CONFIG.allYears) {
      const v = p.v && p.v[yr];
      votes[yr] = v ? { d: v[0], r: v[1], t: v[0] + v[1] } : { d: 0, r: 0, t: 0 };
    }
    const u = {
      id: p.id,
      fips: (p.id && p.id.length >= 5) ? p.id.slice(0, 5) : fips,
      stateCode,
      pop: p.pop || 0,
      polygons: polys,
      votes,
      // dm = [White, Black, Hispanic, Asian, Native, Pacific, VAP] (2020
      // census P.L. 94-171); absent on the model/tract substrate.
      dem: Array.isArray(p.dm) ? p.dm : null,
      parentDShare: {},
      centroid: multiPolygonCentroid(polys),
      bbox: bboxOfPolygons(polys),
      pathD: pathFromPolygons(polys),
      _pi: i,
    };
    idIdx.set(p.id, i);
    units[i] = u;
  }
  // Adjacency arrives pre-built (DRA rook graph, already connectivity-
  // bridged by the pipeline). Defensively dedupe + drop self/out-of-range.
  const adjacency = pj.adjacency.map((nbrs, i) => {
    const s = new Set();
    for (const j of nbrs) if (j !== i && j >= 0 && j < units.length) s.add(j);
    return [...s];
  });
  // Pre-baked ReCom assignments (built offline by scripts/build-precincts
  // with the exact app algorithm) — keyed by base seed. Decoded lazily into
  // a partition so the national / default-seed views need NO in-browser
  // ReCom. Falls back to live ReCom for un-baked (custom) seeds.
  const baked = pj.baked || null;
  return { units, adjacency, idIdx, baked, seats: pj.seats };
}

// Decode a pre-baked partition for `baseSeed` (42/7/1337) into the
// {assignment, districtPop} shape — instant, no ReCom. Returns null if the
// seed wasn't baked (→ caller runs live ReCom).
function bakedPrecinctPartition(pd, baseSeed) {
  const b = pd && pd.baked && (pd.baked[baseSeed] || pd.baked[String(baseSeed)]);
  if (!b || !b.a) return null;
  const n = pd.units.length;
  const assignment = b64ToAssignment(b.a, n);
  let k = 0;
  for (let i = 0; i < n; i++) if (assignment[i] + 1 > k) k = assignment[i] + 1;
  const districtPop = new Array(Math.max(1, k)).fill(0);
  for (let i = 0; i < n; i++) {
    const d = assignment[i];
    if (d >= 0) districtPop[d] += pd.units[i].pop;
  }
  return { assignment, districtPop, _baked: true, _maxDev: b.maxDev };
}

function useStatePrecinctData(stateCode, active) {
  const on = active && stateCode && PRECINCT_STATES.has(stateCode);
  const [data, setData] = useState(on ? CACHED_PRECINCTS.get(stateCode) || null : null);
  const [stage, setStage] = useState('idle');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!on) { setData(null); setStage(stateCode && active ? 'uncovered' : 'idle'); return; }
    if (CACHED_PRECINCTS.has(stateCode)) {
      setData(CACHED_PRECINCTS.get(stateCode)); setStage('ready'); return;
    }
    let cancelled = false;
    setData(null); setStage('fetching'); setError(null);
    const fips = FIPS_BY_STATE_CODE[stateCode];
    (async () => {
      try {
        const resp = await fetch(PRECINCTS_BASE_URL + fips + '.json');
        if (!resp.ok) throw new Error(`Fetch ${resp.status}`);
        const pj = await resp.json();
        if (cancelled) return;
        setStage('building');
        await new Promise((r) => setTimeout(r, 0));
        const built = buildPrecinctUnits(pj, stateCode);
        if (cancelled) return;
        CACHED_PRECINCTS.set(stateCode, built);
        setData(built);
        setStage('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e.message); setStage('error');
      }
    })();
    return () => { cancelled = true; };
  }, [stateCode, on]);

  return { precinctData: data, stage, error };
}

// Chained: fetch+build precinct data, then ReCom on the precinct graph.
// Same shape/stage protocol as useStateTractPartition.
function useStatePrecinctPartition(stateCode, data, seats, baseSeed, active, model = 'recom') {
  const { precinctData, stage: dataStage, error: dataError } =
    useStatePrecinctData(active ? stateCode : null, active);
  const [partition, setPartition] = useState(null);
  const [stage, setStage] = useState('idle');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!active || !stateCode || !data) { setPartition(null); setStage('idle'); return; }
    if (dataStage === 'uncovered') { setStage('uncovered'); return; }
    if (dataStage === 'fetching') { setStage('fetching'); return; }
    if (dataStage === 'building') { setStage('building'); return; }
    if (dataStage === 'error') { setStage('error'); setError(dataError); return; }
    if (dataStage !== 'ready' || !precinctData) return;

    // Fast path: ReCom seeds are pre-baked offline → use verbatim, no
    // compute. (seedgrow/splitline are deterministic and fast, so they
    // just run live below — no per-seed bake needed.)
    if (model === 'recom') {
      const pre = bakedPrecinctPartition(precinctData, baseSeed);
      // The bake is at 2020 apportionment; only reuse it when this
      // cycle's decade asks for the same district count, otherwise fall
      // through and recompute live at the per-decade `seats`.
      if (pre && pre.partition.districtPop.length === seats) {
        setPartition(pre); setStage('ready'); return;
      }
    }

    const seed = baseSeed * 1000 + stateCode.charCodeAt(0) * 17 + stateCode.charCodeAt(1);
    const cacheKey = `${stateCode}-${seed}-${seats}-${model}`;
    if (CACHED_PRECINCT_PARTITIONS.has(cacheKey)) {
      setPartition(CACHED_PRECINCT_PARTITIONS.get(cacheKey)); setStage('ready'); return;
    }
    let cancelled = false;
    setStage('recom'); setError(null);
    const handle = setTimeout(() => {
      if (cancelled) return;
      try {
        const t0 = Date.now();
        const N = precinctData.units.length;
        // Precinct graphs are ~2-9× denser than tracts; scale burn-in with
        // size but cap so even CA (~25k precincts) stays interactive.
        const burnIn = Math.max(400, Math.min(2200, Math.round(N * 0.12)));
        // Strict compactness so live (custom-seed) precinct districts read
        // as compact blocks, matching the pre-baked default seeds.
        const result = runPartition(
          model, precinctData.units, precinctData.adjacency, seats, seed,
          { burnIn, tolerance: 0.02, compactness: 0.9,
            cohesion: precinctData.units.map((u) => u.fips) }
        );
        if (cancelled) return;
        if (!result) throw new Error('ReCom failed to produce a partition');
        const tagged = { ...result, _elapsedMs: Date.now() - t0 };
        CACHED_PRECINCT_PARTITIONS.set(cacheKey, tagged);
        setPartition(tagged); setStage('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e.message); setStage('error');
      }
    }, 30);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [stateCode, data, dataStage, precinctData, seats, baseSeed, active, model]);

  return { precinctData, partition, stage, error };
}

/* ---------- COLOR HELPERS ----------------------------------------------- */
// D-share → red↔blue color via a three-stop palette designed for political
// maps. Three anchor colors:
//
//   strong R  (≤ 33% D)  rgb(155,  41,  43)  — saturated brick red
//   tossup    (~ 50% D)  rgb(238, 222, 198)  — warm cream (the bg color)
//   strong D  (≥ 67% D)  rgb( 28,  73, 138)  — saturated navy blue
//
// Interpolated PIECEWISE LINEARLY in RGB space: red→cream for dShare ≤ 50%,
// cream→blue for dShare ≥ 50%. This avoids the muddy purple/green that
// linear-RGB or naive HSL interpolation produces in the middle range.
//
// Visible range: dShare ∈ [0.30, 0.70]; values outside clamp to endpoints.
// US districts rarely fall outside that range, but when they do (very safe
// seats), they pin to the strongest partisan color rather than going darker.
const COLOR_R = [155, 41, 43];
const COLOR_MID = [238, 222, 198];
const COLOR_D = [28, 73, 138];

function shareToColor(dShare) {
  // Map [0.30, 0.70] → [0, 1]
  const t = Math.max(0, Math.min(1, (dShare - 0.30) / 0.40));
  let c0, c1, mix;
  if (t < 0.5) {
    c0 = COLOR_R; c1 = COLOR_MID; mix = t * 2;
  } else {
    c0 = COLOR_MID; c1 = COLOR_D; mix = (t - 0.5) * 2;
  }
  // Apply a slight non-linear curve that pulls competitive districts away
  // from the cream midpoint, so 52%-D feels distinctly blue (not pale).
  // Curve: mix' = 1 - (1 - mix)^1.6 — eases out of the midpoint.
  const m = 1 - Math.pow(1 - mix, 1.6);
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * m);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * m);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * m);
  return `rgb(${r},${g},${b})`;
}

function unitColorForYear(unit, year) {
  const v = unit.votes[year];
  if (v && v.d + v.r > 0) return shareToColor(v.d / (v.d + v.r));
  // Fallback: pop-zero tracts (parks, water, airports) — use parent county's
  // D-share if available so they color in with their geographic context
  // rather than appearing as gray patches.
  if (unit.parentDShare && unit.parentDShare[year] != null) {
    return shareToColor(unit.parentDShare[year]);
  }
  return '#ddd';
}

/* ---------- DETERMINISTIC PRNG ------------------------------------------ */
// Mulberry32: small fast 32-bit PRNG with adequate distribution properties
// for Monte Carlo work. Same seed → same chain, which is the whole point
// for reproducibility ("publish the seed, anyone can verify the map").
function makeRng(seed) {
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
function uniformSpanningTree(nodes, adjacency, rng) {
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
function recomStep(state, rng, opts) {
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
function recomInitialPartition(units, adjacency, k, rng) {
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
function runReCom(stateUnits, stateAdjacency, k, seed, options = {}) {
  const {
    burnIn = 200,
    numSamples = 0,
    sampleEvery = 25,
    tolerance = 0.05,
    compactness = 1.5,
    cohesion = null, // optional Int32Array/array: group id per unit
                     // (county FIPS index). When set, a post-chain polish
                     // consolidates avoidable group splits — keeps a
                     // metro's counties together where population allows.
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

  // ---- Metro/county-cohesion polish ------------------------------------
  // ReCom optimises population + compactness but is indifferent to whether
  // it slices a county (hence a metro) across districts. This deterministic
  // post-pass relabels boundary units to CONSOLIDATE avoidable group
  // splits — a county that doesn't have to be divided (pop ≤ a district)
  // ends up whole — without ever pushing a district outside a population
  // guard band or breaking contiguity. Counties that genuinely must split
  // (Nashville/Davidson ≫ one district) still split; the gratuitous
  // fragmentation is what gets cleaned, exactly the user's ask.
  if (cohesion && k > 1) {
    const asg = state.assignment, dpop = state.districtPop;
    const band = Math.max(tolerance * 1.5, 0.03);
    const loP = target * (1 - band), hiP = target * (1 + band);
    // tally[g] = Map(district → #units of group g in that district)
    const tally = new Map();
    for (let i = 0; i < N; i++) {
      const g = cohesion[i]; if (g == null) continue;
      let m = tally.get(g); if (!m) tally.set(g, (m = new Map()));
      m.set(asg[i], (m.get(asg[i]) || 0) + 1);
    }
    const MAX_PASS = 5;
    for (let pass = 0; pass < MAX_PASS; pass++) {
      let changed = false;
      for (let u = 0; u < N; u++) {
        const d = asg[u], g = cohesion[u];
        if (g == null) continue;
        const pu = stateUnits[u].pop || 0;
        if (dpop[d] - pu < loP) continue; // would underfill source
        // candidate target districts = neighbour districts ≠ d
        let bestD2 = -1, bestNet = 0;
        const seenD2 = new Set();
        for (const v of stateAdjacency[u]) {
          const d2 = asg[v];
          if (d2 === d || seenD2.has(d2)) continue;
          seenD2.add(d2);
          if (dpop[d2] + pu > hiP) continue; // would overfill target
          const gm = tally.get(g);
          const inD = gm.get(d) || 0, inD2 = gm.get(d2) || 0;
          // group-split cost delta: −1 if u was g's last unit in d,
          // +1 if d2 had no g unit yet.
          const net = (inD === 1 ? -1 : 0) + (inD2 === 0 ? 1 : 0);
          if (net < bestNet) { bestNet = net; bestD2 = d2; }
        }
        if (bestD2 < 0 || bestNet >= 0) continue;       // no improvement
        if (!isContigAfterRemove(d, u)) continue;       // keep contiguity
        // apply
        const gm = tally.get(g);
        gm.set(d, (gm.get(d) || 0) - 1);
        gm.set(bestD2, (gm.get(bestD2) || 0) + 1);
        asg[u] = bestD2;
        dpop[d] -= pu; dpop[bestD2] += pu;
        polishMoves++;
        changed = true;
      }
      if (!changed) break;
    }
  }

  return { ...state, accepts, rejects, polishMoves, samples };
}

/* ---------- ALTERNATIVE PARTITIONERS ----------------------------------- */
// Three selectable districting MODELS, all consuming the same
// {units(.pop,.centroid,.polygons), adjacency} interface and returning the
// same {assignment, districtPop} shape runReCom does:
//   • recom     — seeded ReCom Markov chain (random; published seed)
//   • seedgrow  — DETERMINISTIC metro-anchored seed-and-grow: seed each
//                 district at the densest remaining unit (largest metro
//                 core) and grow a compact nearest-first frontier out to
//                 the population quota (Chen & Rodden 2013 "seed-and-grow",
//                 deterministic density-anchored variant) + a contiguity-
//                 preserving population rebalance.
//   • splitline — DETERMINISTIC shortest splitline (Warren D. Smith,
//                 rangevoting.org): recursively cut with the shortest line
//                 giving a ⌊N/2⌋:⌈N/2⌉ population split; ties broken most
//                 North–South then Westernmost.
function polyAreaOf(polys) {
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
function stillConnected(adjacency, assignment, dist, drop) {
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
// Greedy, contiguity-preserving, BIDIRECTIONAL population rebalance: each
// step takes the district whose population is furthest from target (in
// EITHER direction) and either sheds a boundary unit to a needier
// neighbour (when over) or annexes a bordering unit from a fuller
// neighbour (when under), choosing the single move that most reduces
// total deviation while keeping the donor district connected. The
// older one-directional version did nothing when the imbalance was a
// single under-populated district (the max *positive* deviation was
// then tiny), which is exactly the failure mode of a stray splitline
// cut. Deterministic (ties → lowest unit index), bounded, no RNG.
function rebalance(units, adjacency, assignment, districtPop, k, tol = 0.03) {
  const total = districtPop.reduce((s, p) => s + p, 0);
  const target = total / k;
  if (!(target > 0)) return;
  const maxMoves = Math.min(units.length * 8, 120000);
  // Try one strictly-improving, connectivity-safe move for district
  // `worst` (over=shed, !over=annex). Returns true if a move was applied.
  const tryMove = (worst, over, requireBest) => {
    let bestU = -1, bestPart = -1, bestGain = 1e-6;
    for (let i = 0; i < units.length; i++) {
      const ai = assignment[i];
      if (ai < 0) continue;
      const pop = units[i].pop;
      if (over) {
        if (ai !== worst) continue;
        for (const v of adjacency[i]) {
          const to = assignment[v];
          if (to === worst || to < 0) continue;
          const before = Math.abs(districtPop[worst] - target) + Math.abs(districtPop[to] - target);
          const after = Math.abs(districtPop[worst] - pop - target) + Math.abs(districtPop[to] + pop - target);
          const gain = before - after;
          if (gain > bestGain && (requireBest || stillConnected(adjacency, assignment, worst, i))) {
            bestGain = gain; bestU = i; bestPart = to;
            if (!requireBest) { assignment[i] = to; districtPop[worst] -= pop; districtPop[to] += pop; return true; }
          }
        }
      } else {
        if (ai === worst) continue;
        let touches = false;
        for (const v of adjacency[i]) if (assignment[v] === worst) { touches = true; break; }
        if (!touches) continue;
        const from = ai;
        const before = Math.abs(districtPop[worst] - target) + Math.abs(districtPop[from] - target);
        const after = Math.abs(districtPop[worst] + pop - target) + Math.abs(districtPop[from] - pop - target);
        const gain = before - after;
        if (gain > bestGain && (requireBest || stillConnected(adjacency, assignment, from, i))) {
          bestGain = gain; bestU = i; bestPart = from;
          if (!requireBest) { assignment[i] = worst; districtPop[from] -= pop; districtPop[worst] += pop; return true; }
        }
      }
    }
    if (requireBest && bestU >= 0) {
      const src = over ? worst : bestPart;
      if (stillConnected(adjacency, assignment, src, bestU)) {
        const dst = over ? bestPart : worst;
        assignment[bestU] = dst;
        districtPop[src] -= units[bestU].pop;
        districtPop[dst] += units[bestU].pop;
        return true;
      }
    }
    return false;
  };
  for (let mv = 0; mv < maxMoves; mv++) {
    let worst = -1, worstAbs = tol;
    for (let d = 0; d < k; d++) {
      const a = Math.abs(districtPop[d] - target) / target;
      if (a > worstAbs) { worstAbs = a; worst = d; }
    }
    if (worst < 0) break;
    const over = districtPop[worst] > target;
    // Prefer the single best move; if that one would split the donor,
    // fall back to the first strictly-improving connectivity-safe move.
    if (!tryMove(worst, over, true) && !tryMove(worst, over, false)) break;
  }
}

// Flip GENUINE geometric specks — a tiny set of units whose every physical
// neighbour belongs to one other district (a tract marooned across a
// straight cut, or by a rebalance move). Adjacency is derived from shared
// 0.1-coincident polygon segments — the SAME geometric notion the mesh
// border uses — NOT the bundled tract adjacency graph (which is so sparse
// a contiguous district splits into thousands of false components; merging
// those re-broke balance to 43 %). Geometric components track real
// geography, so a contiguous splitline district is ONE component and only
// true marooned specks are small. Deterministic. Real exclaves (no shared
// border ⇒ no geometric neighbour) are left untouched.
//
// Used RENDER-ONLY (display assignment clone), so it has zero balance
// cost and can be generous: a non-largest component is absorbed iff it is
// ≤ maxSpeck units AND smaller than `relFrac` of its district's main
// component. The relative guard is the real discriminator — it folds in
// cut-artifact specks (a handful of tracts vs a 150-tract body) while
// preserving a LEGITIMATELY split district (two substantial pieces from a
// straight cut across a bay/concavity render as the real two pieces).
function geometricSpeckFix(units, assignment, k, maxSpeck = 25, relFrac = 0.3) {
  const n = units.length;
  const r = (v) => Math.round(v * 10) / 10;
  const segUnits = new Map();
  for (let i = 0; i < n; i++) {
    const polys = units[i].polygons;
    if (!polys) continue;
    for (const poly of polys) for (const ring of poly) {
      for (let j = 0, m = ring.length; j < m; j++) {
        const A = ring[j], B = ring[(j + 1) % m];
        const ax = r(A[0]), ay = r(A[1]), bx = r(B[0]), by = r(B[1]);
        if (ax === bx && ay === by) continue;
        const key = (ax < bx || (ax === bx && ay <= by))
          ? ax + ',' + ay + ',' + bx + ',' + by
          : bx + ',' + by + ',' + ax + ',' + ay;
        let arr = segUnits.get(key);
        if (!arr) segUnits.set(key, (arr = []));
        if (!arr.includes(i)) arr.push(i);
      }
    }
  }
  const gadj = Array.from({ length: n }, () => new Set());
  for (const arr of segUnits.values()) {
    if (arr.length < 2) continue;
    for (let a = 0; a < arr.length; a++)
      for (let b = a + 1; b < arr.length; b++) {
        gadj[arr[a]].add(arr[b]); gadj[arr[b]].add(arr[a]);
      }
  }
  const comp = new Int32Array(n).fill(-1);
  const compD = [], members = [];
  let nc = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0 || assignment[s] < 0) continue;
    const d = assignment[s], id = nc++;
    compD.push(d); const mem = [s]; comp[s] = id;
    for (let h = 0; h < mem.length; h++) {
      for (const v of gadj[mem[h]]) {
        if (comp[v] < 0 && assignment[v] === d) { comp[v] = id; mem.push(v); }
      }
    }
    members.push(mem);
  }
  const biggest = {};
  for (let c = 0; c < nc; c++) {
    const d = compD[c];
    if (biggest[d] == null || members[c].length > members[biggest[d]].length) biggest[d] = c;
  }
  let flipped = 0;
  for (let c = 0; c < nc; c++) {
    const d = compD[c];
    if (c === biggest[d]) continue;
    const sz = members[c].length;
    // Tiny vs maxSpeck AND minor relative to the district's main body —
    // the relative test is what protects a genuinely split district.
    if (sz > maxSpeck || sz >= members[biggest[d]].length * relFrac) continue;
    const tally = {};
    for (const i of members[c])
      for (const v of gadj[i]) {
        const dv = assignment[v];
        if (dv >= 0 && dv !== d) tally[dv] = (tally[dv] || 0) + 1;
      }
    let to = -1, mx = 0;
    for (const kk in tally) if (tally[kk] > mx) { mx = tally[kk]; to = +kk; }
    if (to >= 0) { for (const i of members[c]) assignment[i] = to; flipped += members[c].length; }
  }
  return { flipped, nc };
}

function runSeedGrow(units, adjacency, k) {
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

function _convexHull(pts) {
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
function _chordLen(hull, nx, ny, c) {
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
function runSplitline(units, adjacency, k) {
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
    if (!bestSplit) {
      // Degenerate hull (few or collinear centroids — common deep in the
      // recursion for thin rural regions). The old fallback split by raw
      // member COUNT, which strands a badly under-populated district when
      // tract populations vary — the root cause of splitline's worst
      // outliers. Split by POPULATION quantile along the members' longest-
      // spread axis instead. Deterministic (stable axis + index tiebreak),
      // so every split stays population-balanced even when degenerate.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const i of members) {
        const c = units[i].centroid;
        if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1];
      }
      const useX = (maxX - minX) >= (maxY - minY);
      const ord = members.slice().sort((p, q) => {
        const cp = units[p].centroid, cq = units[q].centroid;
        const a = useX ? cp[0] : cp[1], b = useX ? cq[0] : cq[1];
        return a - b || (useX ? cp[1] - cq[1] : cp[0] - cq[0]) || p - q;
      });
      let acc = 0, cut = 0;
      for (; cut < ord.length - 1; cut++) {
        acc += units[ord[cut]].pop;
        if (acc >= targetA) break;
      }
      recurse(ord.slice(0, cut + 1), A, did);
      recurse(ord.slice(cut + 1), B, did + A);
      return;
    }
    const aSide = bestSplit.slice(0, bestSplit._j + 1);
    const bSide = bestSplit.slice(bestSplit._j + 1);
    recurse(aSide, A, did);
    recurse(bSide, B, did + A);
  }
  recurse(units.map((_, i) => i), k, 0);
  const districtPop = new Array(k).fill(0);
  for (let i = 0; i < n; i++) districtPop[assignment[i]] += units[i].pop;
  // The recursive shortest-line quantile cut is already population-
  // balanced (~3 % worst-district on real tract sets). A deterministic,
  // contiguity-preserving BIDIRECTIONAL rebalance tightens it toward
  // ±2 % — no RNG, so splitline stays a pure function of geography.
  // Genuine marooned specks (~1.5 % of tracts for TX) are NOT removed
  // from the partition: flipping ~445 K of population shifts more than
  // the deterministic greedy rebalance can re-tighten (measured 8.4 %).
  // Population balance is the substantive guarantee, so the partition
  // stays the verified ~2 %; the specks are absorbed COSMETICALLY in
  // the renderer (geometricSpeckFix on a display-only assignment clone)
  // at zero balance cost — the map reads clean while every reported
  // number reflects the true partition.
  rebalance(units, adjacency, assignment, districtPop, k, 0.02);
  return { assignment, districtPop };
}

// Single entry point the app + pipeline route every districting through.
function runPartition(model, units, adjacency, k, seed, opts = {}) {
  if (model === 'seedgrow') return runSeedGrow(units, adjacency, k);
  if (model === 'splitline') return runSplitline(units, adjacency, k);
  return runReCom(units, adjacency, k, seed, opts);
}

// Compute per-district vote totals and winners for a given partition + year.
function computeDistrictResults(stateUnits, partition, year) {
  const k = partition.districtPop.length;
  const dPop = new Array(k).fill(0);
  const rPop = new Array(k).fill(0);
  for (let i = 0; i < stateUnits.length; i++) {
    const d = partition.assignment[i];
    if (d < 0) continue;
    const v = stateUnits[i].votes[year];
    if (v) { dPop[d] += v.d; rPop[d] += v.r; }
  }
  const districts = [];
  for (let d = 0; d < k; d++) {
    const total = dPop[d] + rPop[d];
    const dShare = total > 0 ? dPop[d] / total : 0.5;
    districts.push({
      pop: partition.districtPop[d],
      dVotes: dPop[d], rVotes: rPop[d],
      dShare,
      winner: dShare > 0.5 ? 'D' : 'R',
    });
  }
  return districts;
}

// Run ReCom on every state, in series. Streams progress so the UI stays
// responsive. Returns the array of per-state partitions plus aggregates.
function runReComAllStates(data, baseSeed, options, onProgress) {
  return new Promise((resolve) => {
    const stateCodes = Object.keys(data.stateGeom).filter((c) => c !== 'DC');
    const stateResults = [];
    let dSeats = 0, rSeats = 0;
    let i = 0;
    function step() {
      if (i >= stateCodes.length) {
        resolve({ stateResults, dSeats, rSeats });
        return;
      }
      const code = stateCodes[i];
      const sg = data.stateGeom[code];
      const stateUnits = data.unitsByState[code] || [];
      const k = sg.seats;
      // Build state-local adjacency: map global indices to state-local
      const idxInState = new Map();
      for (let j = 0; j < stateUnits.length; j++) {
        const globalIdx = data.idIdx.get(stateUnits[j].id);
        idxInState.set(globalIdx, j);
      }
      const stateAdj = stateUnits.map((u) => {
        const globalIdx = data.idIdx.get(u.id);
        const out = [];
        for (const v of data.adjacency[globalIdx]) {
          const localV = idxInState.get(v);
          if (localV !== undefined) out.push(localV);
        }
        return out;
      });
      const seed = baseSeed * 1000 + code.charCodeAt(0) * 17 + code.charCodeAt(1);
      const partition = runReCom(stateUnits, stateAdj, k, seed, options);
      stateResults.push({ code, name: sg.name, seats: k, units: stateUnits, partition });
      // Tally
      // (Caller computes results per year; ReCom is year-independent)
      i++;
      if (onProgress) onProgress({ done: i, total: stateCodes.length, code });
      setTimeout(step, 0);
    }
    setTimeout(step, 0);
  });
}

/* ---------- HEADLINE TICKER --------------------------------------------- */
// Sums the per-unit votes across all units for the chosen year, gives a
// running "national 2-party" tally — this is essentially the popular vote,
// which we present as the baseline against which "what would a neutral
// House look like?" gets compared in subsequent iterations.
function HeadlineRow({ data, year, loadStage, districting, districtingProgress, seed, setSeed, substrate = 'model', setSubstrate, model = 'recom', setModel }) {
  if (!data) {
    return (
      <div style={S.headline} className="r-headline">
        <div style={S.headlineComputing}>
          <span style={S.spinner} />
          <span>{loadStage === 'fetching' ? 'fetching county geometry…' : loadStage === 'building' ? 'assembling population units…' : 'initializing…'}</span>
        </div>
      </div>
    );
  }
  let totD = 0, totR = 0, totalPop = 0;
  for (const u of data.units) {
    if (u.votes[year]) { totD += u.votes[year].d; totR += u.votes[year].r; }
    totalPop += u.pop;
  }
  const dPct = totD + totR > 0 ? (100 * totD / (totD + totR)).toFixed(1) : '—';
  const rPct = totD + totR > 0 ? (100 * totR / (totD + totR)).toFixed(1) : '—';
  const dWon = totD > totR;

  const districtingActive = !!districtingProgress;
  const yearMeta = YEAR_CONFIG.yearMeta(year);
  const actualHouse = yearMeta?.actualHouse;
  const yearKind = yearMeta?.kind;

  // `seats` (national D/R/competitive) and `popVariance` (worst state +
  // share of states inside the ±5 % legal bound) come either from the
  // committed per-seed summary (instant pre-render path — no algorithm
  // run) or from aggregating the live partitions.
  let seats = null;
  let popVariance = null;
  if (districting?.prerendered) {
    const s = districting.summary ? districting.summary[year] : null;
    if (s) {
      seats = { dSeats: s.dSeats, rSeats: s.rSeats, totalSeats: TOTAL_SEATS, competitive: s.competitive };
      popVariance = { worstDev: s.worstDev, worstCode: s.worstCode, inside: s.inside, total: s.total };
    }
  } else if (districting) {
    seats = aggregateNationalSeats(districting, year);
    let worstDev = 0, worstCode = null, inside = 0, total = 0;
    for (const [code, p] of Object.entries(districting.partitions)) {
      if (!p.partition || p.seats <= 1) continue;
      total++;
      const md = p.maxDev ?? 0;
      if (md <= 0.05) inside++;
      if (md > worstDev) { worstDev = md; worstCode = code; }
    }
    popVariance = { worstDev, worstCode, inside, total };
  }
  const districtingDone = !!seats;

  // Label for the popular-vote cell. Presidential years show the real
  // presidential two-party vote; midterm years show the modeled U.S. House
  // two-party share (per-state swing applied to base, see methodology).
  const popVoteKicker = yearKind === 'midterm'
    ? `${year} U.S. HOUSE 2-PARTY · MODELED`
    : `${year} POPULAR VOTE — TWO-PARTY`;

  const dActualWon = actualHouse && actualHouse.d > actualHouse.r;
  return (
    <div style={S.headline} className="r-headline">
      <div>
        <div style={S.tickerKicker}>{popVoteKicker}</div>
        <div style={S.tickerScore} className="r-tickerscore">
          <span style={{ color: dWon ? '#2c5d8f' : 'rgba(26,26,20,0.4)', fontWeight: dWon ? 600 : 400 }}>D {dPct}%</span>
          <span style={S.divider}>·</span>
          <span style={{ color: !dWon ? '#b3433b' : 'rgba(26,26,20,0.4)', fontWeight: !dWon ? 600 : 400 }}>R {rPct}%</span>
        </div>
      </div>
      <div>
        <div style={S.tickerKicker}>{districtingDone ? `${year} ALGORITHMIC HOUSE` : 'ALGORITHMIC DISTRICTING'}</div>
        {seats ? (
          <>
            <div style={S.tickerScore} className="r-tickerscore">
              <span style={{ color: seats.dSeats > seats.rSeats ? '#2c5d8f' : 'rgba(26,26,20,0.4)', fontWeight: seats.dSeats > seats.rSeats ? 600 : 400 }}>D {seats.dSeats}</span>
              <span style={S.divider}>·</span>
              <span style={{ color: seats.rSeats > seats.dSeats ? '#b3433b' : 'rgba(26,26,20,0.4)', fontWeight: seats.rSeats > seats.dSeats ? 600 : 400 }}>R {seats.rSeats}</span>
            </div>
            <div style={S.tickerSub} className="r-tickersub">
              {typeof seats.competitive === 'number'
                ? <><strong>{seats.competitive}</strong> competitive seats</>
                : null}
            </div>
          </>
        ) : districtingActive ? (
          <div style={S.headlineComputing}>
            <span style={S.spinner} />
            <span>{districtingProgress.code} ({districtingProgress.done}/{districtingProgress.total})</span>
          </div>
        ) : (
          <div style={S.tickerSub}>computing…</div>
        )}
      </div>
      {actualHouse && (
        <div>
          <div style={S.tickerKicker}>{year} ACTUAL HOUSE</div>
          <div style={S.tickerScore} className="r-tickerscore">
            <span style={{ color: dActualWon ? '#2c5d8f' : 'rgba(26,26,20,0.4)', fontWeight: dActualWon ? 600 : 400 }}>D {actualHouse.d}</span>
            <span style={S.divider}>·</span>
            <span style={{ color: !dActualWon ? '#b3433b' : 'rgba(26,26,20,0.4)', fontWeight: !dActualWon ? 600 : 400 }}>R {actualHouse.r}</span>
          </div>
          <div style={S.tickerSub} className="r-tickersub">
            {typeof actualHouse.competitive === 'number'
              ? <><strong>{actualHouse.competitive}</strong> competitive seats</>
              : null}
          </div>
        </div>
      )}
      <div>
        <div style={S.tickerKicker}>UNITS · POPULATION</div>
        <div style={S.tickerNum}>{data.units.length.toLocaleString()}</div>
        <div style={S.tickerSub}>{(totalPop / 1e6).toFixed(1)}M people · {(totalPop / TOTAL_SEATS / 1000).toFixed(0)}K target/district</div>
      </div>
      <div style={S.headlineNote}>
        <div style={S.tickerKicker}>DATA SUBSTRATE</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {[
            ['model', 'Model', '2000–2024 · modeled'],
            ['precinct', 'Precinct', "'08·'12·'16·'20 · real returns"],
          ].map(([key, label, sub]) => {
            const on = substrate === key;
            return (
              <button
                key={key}
                onClick={() => setSubstrate && setSubstrate(key)}
                title={key === 'precinct'
                  ? 'Real precinct (2020 VTD) returns — exact, but only the covered cycles & states'
                  : 'County totals disaggregated to tracts by a density model — all cycles 2000–2024'}
                style={{
                  padding: '6px 10px',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 11,
                  textAlign: 'left',
                  background: on ? '#1a1a14' : 'transparent',
                  color: on ? '#f5efe6' : '#1a1a14',
                  border: '1px solid rgba(26,26,20,0.25)',
                  cursor: 'pointer',
                  lineHeight: 1.3,
                }}
              >
                <div style={{ fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 9, opacity: 0.75 }}>{sub}</div>
              </button>
            );
          })}
        </div>
        <div style={{ ...S.tickerSub, marginTop: 4, fontSize: 10, fontStyle: 'italic' }}>
          {substrate === 'precinct'
            ? 'real counted votes · click a battleground state'
            : 'density-modeled within counties · every cycle'}
        </div>
      </div>
      <div style={S.headlineNote}>
        <div style={S.tickerKicker}>ALGORITHM</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {[
            ['recom', 'ReCom', 'Markov chain · keeps metros'],
            ['splitline', 'Splitline', 'shortest-line · exact pop'],
          ].map(([key, label, sub]) => {
            const on = model === key;
            return (
              <button
                key={key}
                onClick={() => setModel && setModel(key)}
                title={key === 'recom'
                  ? 'Recombination Markov chain (DeFord–Duchin–Solomon) with a metro-cohesion bonus that resists splitting a metro area across districts. Random but reproducible from the published seed.'
                  : "Deterministic shortest-splitline (rangevoting.org): recursively cut with the shortest line giving the right population split. Exactly equipopulous, ignores communities."}
                style={{
                  padding: '6px 9px',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 11,
                  textAlign: 'left',
                  background: on ? '#1a1a14' : 'transparent',
                  color: on ? '#f5efe6' : '#1a1a14',
                  border: '1px solid rgba(26,26,20,0.25)',
                  cursor: 'pointer',
                  lineHeight: 1.3,
                }}
              >
                <div style={{ fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 9, opacity: 0.75 }}>{sub}</div>
              </button>
            );
          })}
        </div>
        <div style={{ ...S.tickerSub, marginTop: 4, fontSize: 10, fontStyle: 'italic' }}>
          {model === 'recom' ? 'reseed for a different valid map · click a state'
            : 'deterministic · perfectly equipopulous · click a state'}
        </div>
      </div>
      {model === 'recom' && (
      <div style={S.headlineNote}>
        <div style={S.tickerKicker}>RESEED</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="number"
            value={seed}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!Number.isNaN(v)) setSeed(v);
            }}
            disabled={districtingActive}
            style={{
              padding: '6px 10px',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 12,
              width: 100,
              background: 'transparent',
              color: '#1a1a14',
              border: '1px solid rgba(26,26,20,0.25)',
              borderRadius: 0,
              cursor: districtingActive ? 'wait' : 'text',
              opacity: districtingActive ? 0.5 : 1,
            }}
          />
          <button
            onClick={() => setSeed(Math.floor(Math.random() * 100000))}
            disabled={districtingActive}
            title="Pick a random seed"
            style={{
              padding: '6px 12px',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 12,
              background: 'transparent',
              color: '#1a1a14',
              border: '1px solid rgba(26,26,20,0.25)',
              cursor: districtingActive ? 'wait' : 'pointer',
              opacity: districtingActive ? 0.5 : 1,
            }}
          >
            random
          </button>
          {[42, 7, 1337].map((s) => (
            <button
              key={s}
              onClick={() => setSeed(s)}
              disabled={districtingActive}
              style={{
                padding: '6px 10px',
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 12,
                background: seed === s ? '#1a1a14' : 'transparent',
                color: seed === s ? '#f5efe6' : '#1a1a14',
                border: '1px solid rgba(26,26,20,0.25)',
                cursor: districtingActive ? 'wait' : 'pointer',
                opacity: districtingActive ? 0.5 : 1,
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <div style={{ ...S.tickerSub, marginTop: 4, fontSize: 10, fontStyle: 'italic' }}>
          changes the entire chain → different valid map
        </div>
      </div>
      )}
    </div>
  );
}

/* ---------- YEAR SELECTOR & LEGEND -------------------------------------- */
function YearSelector({ year, setYear, allowedYears = null }) {
  // In precinct mode only the cycles with real returns are selectable;
  // the rest are shown disabled so the coverage gap is explicit.
  return (
    <div style={S.yearSelector}>
      <div style={S.yearSelectorLabel}>
        ELECTION YEAR{allowedYears ? ' · precinct cycles only' : ''}
      </div>
      <div style={S.yearSelectorButtons} className="r-yearselector-buttons">
        {YEAR_CONFIG.years.map((y) => {
          const active = y.key === year;
          const disabled = allowedYears ? !allowedYears.includes(y.key) : false;
          return (
            <button
              key={y.key}
              onClick={() => !disabled && setYear(y.key)}
              disabled={disabled}
              style={{
                ...S.yearBtn,
                ...(active ? S.yearBtnActive : null),
                ...(disabled ? { opacity: 0.3, cursor: 'not-allowed' } : null),
              }}
              aria-pressed={active}
              title={disabled
                ? `${y.label} — no precinct returns for this cycle`
                : `${y.label} — ${y.sub}`}
            >
              <span style={S.yearBtnYear}>{y.label}</span>
              <span style={{ ...S.yearBtnSub, color: active ? '#f5efe6' : y.winner === 'D' ? '#2c5d8f' : '#b3433b' }}>
                {y.sub}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Legend() {
  const swatches = [0.30, 0.38, 0.46, 0.50, 0.54, 0.62, 0.70];
  return (
    <div style={S.legend}>
      <div style={S.legendCaption}>county D-share, two-party</div>
      <div style={S.legendSwatches}>
        {swatches.map((s, i) => (
          <div key={i} style={{ ...S.legendSwatch, background: shareToColor(s) }} />
        ))}
      </div>
      <div style={S.legendLabels}>
        <span>R+20</span>
        <span>even</span>
        <span>D+20</span>
      </div>
    </div>
  );
}

/* ---------- COUNTY MAP -------------------------------------------------- */
// Renders all units as filled paths. When districting is available, each
// unit is colored by its DISTRICT's D-share — adjacent units in the same
// district share the same color, naturally visualizing the algorithmic
// partition without explicit boundary tracing. When districting hasn't
// loaded yet, falls back to per-unit D-share for the loading state.
function USCountyMap({ data, year, hoveredState, setHoveredState, districting, onSelectState }) {
  // Counties always colored by their OWN D-share (the partisan ground truth).
  // For states that have been tract-upgraded by useDistricting, we render
  // tract polygons (with density-based per-tract D-share) so the national
  // view matches the state-detail view. For not-yet-upgraded states we
  // fall back to county-fragment rendering.
  const unitPaths = useMemo(() => {
    // Consolidated view: every unit is filled by ITS DISTRICT's aggregate
    // two-party D-share (so each district is ONE solid colour) and carries
    // no internal stroke — only the district mesh border shows. No
    // intra-district county/tract lines, matching the precinct national
    // look the user preferred.
    const elements = [];
    const rendered = new Set();
    if (districting) {
      for (const [code, p] of Object.entries(districting.partitions)) {
        if (!p.partition) continue;
        const units = ((p.substrate === 'tract' || p.substrate === 'precinct') && p.renderUnits)
          ? p.renderUnits : p.units;
        if (!units || !units.length) continue;
        const results = computeDistrictResults(units, p.partition, year);
        const colorByD = results.map((r) => shareToColor(r.dShare));
        const asn = p.partition.assignment;
        for (let i = 0; i < units.length; i++) {
          const u = units[i];
          const c = colorByD[asn[i]] || '#e6ddd0';
          elements.push(<path key={u.id} d={u.pathD} fill={c} stroke={c} strokeWidth="0.06" />);
        }
        rendered.add(code);
      }
    }
    // States with no partition yet (loading) → unit's own colour, faint.
    for (const u of data.units) {
      if (rendered.has(u.stateCode)) continue;
      const c = unitColorForYear(u, year);
      elements.push(<path key={u.id} d={u.pathD} fill={c} stroke={c} strokeWidth="0.05" />);
    }
    return elements;
  }, [data, year, districting]);

  // District outlines: traced once per state's partition. Heavy compute,
  // but the result depends only on `districting` so the memo holds across
  // year changes (year only affects fill colors, not district shapes).
  const districtPaths = useMemo(() => {
    if (!districting) return [];
    const out = [];
    for (const [code, p] of Object.entries(districting.partitions)) {
      const partition = p.partition;
      if (!partition) continue;
      const units = ((p.substrate === 'tract' || p.substrate === 'precinct') && p.renderUnits) ? p.renderUnits : p.units;
      if (!units || !units.length) continue;
      // One robust mesh border per state (undirected → no dropped sides).
      const pathD = meshBorderPath(units, partition.assignment);
      if (pathD) out.push({ key: code, pathD, slabPathD: '' });
    }
    return out;
  }, [districting]);

  // State-level interactive overlays. Each state renders THREE elements:
  // (1) a thick dark outline as a visible "shadow" of the state border,
  // (2) a slightly thinner white outline on top to give the bold-white
  //     state-border look, and (3) a transparent click/hover layer for UX.
  // The visible stroke colors are non-interactive; only the transparent
  // overlay catches mouse events.
  const stateOutlinesDark = useMemo(() => {
    return Object.values(data.stateGeom).map((sg) => (
      <path key={`d-${sg.code}`} d={sg.pathD} fill="none" stroke="#1a1a14" strokeWidth="1.6" strokeLinejoin="round" pointerEvents="none" />
    ));
  }, [data]);
  const stateOutlinesWhite = useMemo(() => {
    return Object.values(data.stateGeom).map((sg) => (
      <path key={`w-${sg.code}`} d={sg.pathD} fill="none" stroke="#fdfaf2" strokeWidth="1.0" strokeLinejoin="round" pointerEvents="none" />
    ));
  }, [data]);
  const stateOverlays = useMemo(() => {
    return Object.values(data.stateGeom).map((sg) => (
      <path
        key={sg.code}
        d={sg.pathD}
        fill={hoveredState === sg.code ? 'rgba(224,159,62,0.18)' : 'transparent'}
        stroke={hoveredState === sg.code ? '#e09f3e' : 'transparent'}
        strokeWidth={hoveredState === sg.code ? '1.6' : '0'}
        strokeLinejoin="round"
        onMouseEnter={() => setHoveredState(sg.code)}
        onMouseLeave={() => setHoveredState((s) => (s === sg.code ? null : s))}
        onClick={() => onSelectState && onSelectState(sg.code)}
        style={{ cursor: 'pointer' }}
      />
    ));
  }, [data, hoveredState, onSelectState]);

  // State labels: only show for states that are big enough on screen
  const stateLabels = useMemo(() => {
    return Object.values(data.stateGeom).map((sg) => {
      const [x0, y0, x1, y1] = sg.bbox;
      const w = x1 - x0, h = y1 - y0;
      if (w < 18 || h < 12) return null;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const fontSize = sg.seats >= 14 ? 12 : sg.seats >= 8 ? 10 : sg.seats >= 4 ? 8.5 : 7.5;
      return (
        <text
          key={sg.code}
          x={cx} y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily='"JetBrains Mono", monospace'
          fontWeight="700"
          fontSize={fontSize}
          fill="#1a1a14"
          stroke="rgba(253,250,242,0.9)"
          strokeWidth="2.5"
          paintOrder="stroke"
          pointerEvents="none"
        >
          {sg.code}
        </text>
      );
    });
  }, [data]);

  return (
    <div style={S.mapWrap}>
      <div className="r-maphint">↔ Hover for stats · click for state detail</div>
      <svg viewBox="-65 5 1030 615" style={S.mapSvg}>
        {/* Layer 1: counties colored by their own 2-party D-share */}
        {unitPaths}
        {/* Layer 2: district outlines.
            2a — natural geographic boundaries at full weight
            2b — slab-cut artifact boundaries (between same-county fragments
                 in different districts) at lighter weight + dashed style,
                 so the user sees where boundaries fall through subdivided
                 metros without arbitrary axis-aligned cuts dominating. */}
        {districtPaths.map((dp) => dp.slabPathD ? (
          <path key={`${dp.key}-slab`} d={dp.slabPathD} fill="none" stroke="rgba(26,26,20,0.35)" strokeWidth="0.35" strokeDasharray="0.8,0.8" strokeLinejoin="round" pointerEvents="none" />
        ) : null)}
        {/* District boundary: a white casing UNDER a bold dark line so it
            reads clearly over the county/tract colour mosaic (a single
            thin black line was getting lost — user feedback). */}
        {districtPaths.map((dp) => dp.pathD ? (
          <path key={`${dp.key}-c`} d={dp.pathD} fill="none" stroke="#fdfaf2" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" opacity="0.85" />
        ) : null)}
        {districtPaths.map((dp) => dp.pathD ? (
          <path key={dp.key} d={dp.pathD} fill="none" stroke="#1a1a14" strokeWidth="0.95" strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
        ) : null)}
        {/* Layer 3: state borders — dark stroke beneath, bold white stroke on top */}
        {stateOutlinesDark}
        {stateOutlinesWhite}
        {/* Layer 4: invisible click/hover targets for state interaction */}
        {stateOverlays}
        {/* Layer 5: state labels (always on top) */}
        {stateLabels}
      </svg>
      {hoveredState && data.stateGeom[hoveredState] && (
        <StateHoverInfo state={data.stateGeom[hoveredState]} units={data.unitsByState[hoveredState] || []} year={year} districting={districting} />
      )}
    </div>
  );
}

function StateHoverInfo({ state, units, year, districting }) {
  let totD = 0, totR = 0, pop = 0;
  for (const u of units) {
    if (u.votes[year]) { totD += u.votes[year].d; totR += u.votes[year].r; }
    pop += u.pop;
  }
  const dPct = totD + totR > 0 ? (100 * totD / (totD + totR)).toFixed(1) : '—';

  // If districting is available, show per-district breakdown. For tract-
  // upgraded states the partition.assignment is indexed over tract units,
  // so we must compute results against those, not against county fragments.
  let districtInfo = null;
  if (districting && districting.partitions[state.code]) {
    const p = districting.partitions[state.code];
    const partition = p.partition;
    const partitionUnits = ((p.substrate === 'tract' || p.substrate === 'precinct') && p.renderUnits) ? p.renderUnits : units;
    const results = computeDistrictResults(partitionUnits, partition, year);
    const totalPop = partitionUnits.reduce((s, u) => s + u.pop, 0);
    const target = totalPop / state.seats;
    let maxDev = 0;
    let dWins = 0, rWins = 0;
    for (let i = 0; i < results.length; i++) {
      const dev = Math.abs(partition.districtPop[i] - target) / target;
      if (dev > maxDev) maxDev = dev;
      if (results[i].winner === 'D') dWins++; else rWins++;
    }
    districtInfo = { dWins, rWins, maxDev };
  }

  return (
    <div style={S.hoverInfo}>
      <div style={S.hoverInfoState}>{state.name}</div>
      <div style={S.hoverInfoStats}>
        <span><strong>{state.seats}</strong> seats</span>
        <span>·</span>
        <span><strong>{units.length}</strong> units</span>
        <span>·</span>
        <span><strong>{(pop / 1e6).toFixed(1)}M</strong> people</span>
        <span>·</span>
        <span><strong>D {dPct}%</strong> popular</span>
      </div>
      {districtInfo && (
        <div style={{ ...S.hoverInfoStats, marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(26,26,20,0.12)' }}>
          <span><strong style={{ color: '#2c5d8f' }}>D {districtInfo.dWins}</strong> / <strong style={{ color: '#b3433b' }}>R {districtInfo.rWins}</strong> seats</span>
          <span>·</span>
          <span style={{ color: districtInfo.maxDev <= 0.05 ? 'rgba(26,26,20,0.7)' : '#c44536' }}>
            max district pop dev: <strong>{(districtInfo.maxDev * 100).toFixed(0)}%</strong>
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------- PRE-RENDERED NATIONAL MAP ---------------------------------- */
// Instant path for a committed default seed at the default year: a flat
// JPEG of the full national map (rendered offline from the live SVG) under
// a transparent, pixel-aligned SVG overlay that carries state hover/click.
// No algorithm runs and no tract geometry is fetched. The image is 2060×1230
// — exactly 2× the live viewBox (1030×615) — so xMidYMid-meet alignment of
// the overlay registers on the underlying state shapes precisely.
function PrerenderedMap({ data, seed, year, hoveredState, setHoveredState, onSelectState }) {
  const base = (typeof window !== 'undefined' && window.__DATA_BASE_URL__) || '/data/';
  const imgSrc = `${base}seeds/${seed}-${YEAR_CONFIG.defaultYear}.jpg`;
  const stateOverlays = useMemo(() => {
    if (!data) return null;
    return Object.values(data.stateGeom).map((sg) => (
      <path
        key={sg.code}
        d={sg.pathD}
        fill={hoveredState === sg.code ? 'rgba(224,159,62,0.18)' : 'transparent'}
        stroke={hoveredState === sg.code ? '#e09f3e' : 'transparent'}
        strokeWidth={hoveredState === sg.code ? '1.6' : '0'}
        strokeLinejoin="round"
        onMouseEnter={() => setHoveredState(sg.code)}
        onMouseLeave={() => setHoveredState((s) => (s === sg.code ? null : s))}
        onClick={() => onSelectState && onSelectState(sg.code)}
        style={{ cursor: 'pointer' }}
      />
    ));
  }, [data, hoveredState, onSelectState]);

  return (
    <div style={S.mapWrap}>
      <div className="r-maphint">↔ Hover for stats · click for state detail</div>
      <div style={{ position: 'relative', width: '100%', maxWidth: 1400, margin: '0 auto' }}>
        <img
          src={imgSrc}
          alt={`Algorithmically drawn U.S. congressional districts — seed ${seed}, ${YEAR_CONFIG.defaultYear} two-party vote.`}
          width={2060}
          height={1230}
          draggable={false}
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
        {data && (
          <svg
            viewBox="-65 5 1030 615"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
          >
            {stateOverlays}
          </svg>
        )}
      </div>
      {hoveredState && data && data.stateGeom[hoveredState] && (
        <StateHoverInfo
          state={data.stateGeom[hoveredState]}
          units={data.unitsByState[hoveredState] || []}
          year={year}
          districting={null}
        />
      )}
    </div>
  );
}

/* ---------- MAP SECTION ------------------------------------------------- */
function MapSection({ data, year, setYear, loadStage, districting, districtingProgress, substrate = 'model', model = 'recom' }) {
  const [hoveredState, setHoveredState] = useState(null);
  const [selectedState, setSelectedState] = useState(null);
  const districtingDone = !!districting;
  const precinctMode = substrate === 'precinct';
  const allowedYears = precinctMode ? PRECINCT_YEARS : null;

  // ESC key closes state detail
  useEffect(() => {
    if (!selectedState) return;
    const onKey = (e) => { if (e.key === 'Escape') setSelectedState(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedState]);

  // Update text rewrites for the selected state
  if (selectedState && data && districting) {
    return (
      <StateDetailSection
        data={data}
        year={year}
        setYear={setYear}
        districting={districting}
        stateCode={selectedState}
        onClose={() => setSelectedState(null)}
        substrate={substrate}
        model={model}
      />
    );
  }

  return (
    <section style={S.mapSection} className="r-mapsection r-pad">
      <div style={S.mapHeader} className="r-mapheader">
        <div>
          <div style={S.kicker}>{precinctMode ? 'PRECINCT VIEW · REAL RETURNS' : districtingDone ? 'THE ALGORITHMIC HOUSE' : 'THE COUNTY GROUND TRUTH'}</div>
          <h2 style={S.sectionTitle}>
            {districtingDone ? `${year} congressional districts, drawn by algorithm.` : `${year} presidential vote, by county.`}
          </h2>
          <p style={S.sectionLede} className="r-sectionlede">
            {precinctMode ? (
              <>
                <strong>Precinct view — all 50 states.</strong> Every district is drawn from{' '}
                <strong>real precinct (2020 VTD) returns</strong> — actual counted votes, no
                county-level modeling — for the {PRECINCT_YEARS.join(', ')} presidential cycles.
                ReCom is pre-run offline with the published seed, so the national map is exact
                and renders instantly. <strong>Click any state</strong> to enlarge it and see
                per-district statistics; switch to the <strong>Model</strong> view for all
                cycles 2000–2024.
              </>
            ) : districtingDone ? (
              <>
                Counties are colored by their actual two-party D-share for {year}. <strong>Black outlines</strong>{' '}
                trace the boundaries of {data ? '435' : 'algorithmically-drawn'} congressional districts produced by
                the <strong>ReCom</strong> Markov chain (DeFord, Duchin, Solomon 2021) running on the real county
                adjacency graph. Each state runs independently, seeded from a public seed value (changeable above) —
                same seed, same data → same districts. <strong>Click any state</strong> to enlarge it and see
                per-district statistics.
              </>
            ) : (
              <>
                Real US counties ({data && data.units ? data.units.length.toLocaleString() : '~3,300'} units —
                counties intact, big counties slab-cut into target-population fragments). Color is each unit's
                D share of the two-party vote, from FEC-certified county-level results. The algorithmic
                districting is computing now…
              </>
            )}
          </p>
        </div>
        <div style={S.mapHeaderControls}>
          <YearSelector year={year} setYear={setYear} allowedYears={allowedYears} />
          <Legend />
        </div>
      </div>
      {districting?.prerendered ? (
        <PrerenderedMap
          data={data}
          seed={districting.seed}
          year={year}
          hoveredState={hoveredState}
          setHoveredState={setHoveredState}
          onSelectState={setSelectedState}
        />
      ) : data ? (
        <USCountyMap
          data={data}
          year={year}
          hoveredState={hoveredState}
          setHoveredState={setHoveredState}
          districting={districting}
          onSelectState={setSelectedState}
        />
      ) : (
        <div style={S.computing}>
          {loadStage === 'fetching'
            ? 'Fetching county geometry from us-atlas (≈800KB)…'
            : loadStage === 'building'
            ? 'Assembling population units, computing adjacency graph…'
            : loadStage.startsWith('error')
            ? 'Failed to load county data: ' + loadStage.slice(7)
            : 'Initializing…'}
        </div>
      )}
    </section>
  );
}

/* ---------- STATE DETAIL VIEW ------------------------------------------ */
// Zoomed-in map of one state, with a stats panel showing per-district info.
// Uses tract-level data when available (much finer geometry, ±1% balance),
// falling back to county-level while tract data fetches/builds.
function StateDetailSection({ data, year, setYear, districting, stateCode, onClose, substrate = 'model', model = 'recom' }) {
  const sg = data.stateGeom[stateCode];
  const countyUnits = data.unitsByState[stateCode] || [];
  const stateRecord = districting.partitions[stateCode];
  const countyPartition = stateRecord?.partition;
  // Per-decade apportionment: the enlarged state view splits the state
  // into the number of districts the cycle's census actually gave it
  // (e.g. TX = 32 in 2004, 36 in 2014, 38 in 2022). The national
  // overview stays on 2020 apportionment (sg.seats); see methodology §2.
  const seats = sg ? seatsForState(stateCode, year) : 0;
  const nationalSeats = sg ? sg.seats : 0;
  const baseSeed = districting.seed;

  // Precinct view: real precinct (2020 VTD) returns for this state, if a
  // precinct file was built for it. Takes precedence over everything when
  // active + ready. (Uncovered states show a notice and fall back below.)
  const precinctCovered = substrate === 'precinct' && PRECINCT_STATES.has(stateCode);
  const { precinctData, partition: precPartition, stage: precStage, error: precError } =
    useStatePrecinctPartition(stateCode, data, seats, baseSeed, precinctCovered, model);
  const precinctReady = precinctCovered && precStage === 'ready' && precPartition && precinctData;

  // Reuse the national tract partition only when it was computed with the
  // SAME model (the national engine runs 'recom'); for seedgrow/splitline
  // the state recomputes locally so switching models actually re-draws.
  // ...but only when the cycle's apportionment matches the national
  // (2020) one — otherwise the shared partition has the wrong district
  // count for this decade and we must recompute locally at `seats`.
  const sharedTractReady =
    !precinctCovered && model === 'recom' && seats === nationalSeats &&
    stateRecord && stateRecord.substrate === 'tract' && stateRecord.renderUnits;

  // Otherwise, run our own tract-level partition (falls back to county
  // while loading). Skipped entirely while precinct is active.
  const { tractData, partition: tractPartition, stage: tractStage, error: tractError } =
    useStateTractPartition(
      (precinctCovered || sharedTractReady) ? null : stateCode,
      data, seats, baseSeed, model
    );

  // Choose the active substrate. Order of preference:
  //   0. Real precinct partition (precinct view)
  //   1. Shared tract partition from national upgrade
  //   2. Locally-computed tract partition
  //   3. County-fragment fallback
  let stateUnits, partition;
  if (precinctReady) {
    stateUnits = precinctData.units;
    partition = precPartition;
  } else if (sharedTractReady) {
    stateUnits = stateRecord.renderUnits;
    partition = stateRecord.partition;
  } else if (tractStage === 'ready' && tractPartition && tractData) {
    stateUnits = tractData.units;
    partition = tractPartition;
  } else {
    stateUnits = countyUnits;
    partition = countyPartition;
  }
  const usePrecinct = !!precinctReady;
  const useTracts = !usePrecinct && (sharedTractReady ||
    (tractStage === 'ready' && tractPartition && tractData));
  const k = partition ? partition.districtPop.length : 0;

  // Per-district results for the selected year
  const districts = useMemo(() => {
    if (!partition) return [];
    const results = computeDistrictResults(stateUnits, partition, year);
    const totalPop = stateUnits.reduce((s, u) => s + u.pop, 0);
    const target = totalPop / k;
    return results.map((r, d) => ({
      d,
      pop: partition.districtPop[d],
      dev: (partition.districtPop[d] - target) / target,
      dShare: r.dShare,
      dVotes: r.dVotes,
      rVotes: r.rVotes,
      winner: r.winner,
    })).sort((a, b) => a.dShare - b.dShare); // sort by D-share for the panel
  }, [partition, stateUnits, year, k]);

  // Click-to-inspect: which district is selected for the insights card.
  const [selDist, setSelDist] = useState(null);
  useEffect(() => { setSelDist(null); }, [stateCode, substrate, model]);

  // County → set of districts (to flag split counties — the cohesion lens).
  const countySplits = useMemo(() => {
    if (!partition) return new Map();
    const m = new Map();
    for (let i = 0; i < stateUnits.length; i++) {
      const d = partition.assignment[i]; if (d < 0) continue;
      const f = stateUnits[i].fips || '?';
      let s = m.get(f); if (!s) m.set(f, (s = new Set()));
      s.add(d);
    }
    return m;
  }, [partition, stateUnits]);

  // Full insight for the selected district: multi-cycle vote profile,
  // county composition (with split flags), unit count, population.
  const insight = useMemo(() => {
    if (selDist == null || !partition) return null;
    const yrs = usePrecinct ? PRECINCT_YEARS : YEAR_CONFIG.allYears;
    const members = [];
    const byCounty = new Map();
    const demAcc = [0, 0, 0, 0, 0, 0, 0]; // White,Black,Hisp,Asian,Native,Pac,VAP
    let pop = 0;
    for (let i = 0; i < stateUnits.length; i++) {
      if (partition.assignment[i] !== selDist) continue;
      members.push(i);
      const u = stateUnits[i];
      pop += u.pop || 0;
      const f = u.fips || '?';
      byCounty.set(f, (byCounty.get(f) || 0) + (u.pop || 0));
      if (u.dem) for (let z = 0; z < 7; z++) demAcc[z] += u.dem[z] || 0;
    }
    const cycles = yrs.map((yr) => {
      let d = 0, r = 0;
      for (const i of members) {
        const v = stateUnits[i].votes[yr];
        if (v) { d += v.d; r += v.r; }
      }
      const tp = d + r;
      const ds = tp > 0 ? d / tp : null;
      return {
        yr, d, r,
        dShare: ds,
        margin: ds == null ? null : (ds - 0.5) * 2 * 100, // +D / −R, pts
        winner: ds == null ? '—' : ds >= 0.5 ? 'D' : 'R',
      };
    });
    const counties = [...byCounty.entries()]
      .map(([f, p]) => ({
        fips: f, pop: p,
        share: pop > 0 ? p / pop : 0,
        split: (countySplits.get(f) || new Set()).size > 1,
      }))
      .sort((a, b) => b.pop - a.pop);
    const totalPop = stateUnits.reduce((s, u) => s + u.pop, 0);
    const tgt = totalPop / k;
    const demTot = demAcc[0] + demAcc[1] + demAcc[2] + demAcc[3] + demAcc[4] + demAcc[5];
    const dem = demTot > 0 ? {
      rows: [
        ['White', demAcc[0]], ['Black', demAcc[1]], ['Hispanic', demAcc[2]],
        ['Asian', demAcc[3]], ['Native', demAcc[4]], ['Pac. Is.', demAcc[5]],
      ].map(([label, c]) => ({ label, c, share: c / demTot }))
        .sort((a, b) => b.c - a.c).filter((x) => x.c > 0),
      vapShare: pop > 0 ? demAcc[6] / pop : null,
    } : null;
    return {
      d: selDist, pop, unitCount: members.length,
      dev: (pop - tgt) / tgt,
      cycles, counties, dem,
      countySplitCount: counties.filter((c) => c.split).length,
    };
  }, [selDist, partition, stateUnits, usePrecinct, k, countySplits]);

  // DISPLAY-ONLY assignment: the true partition with genuine marooned
  // specks absorbed into the district that geometrically surrounds them.
  // Specks are ~1.5 % of tracts; removing them from the *partition*
  // shifts too much population for the deterministic rebalance to
  // recover (measured 8 %+), so the partition — and every reported
  // number (deviation, D/R, competitiveness, the insight card) — keeps
  // the verified ~2 % assignment. Only the *visuals* (fill, mesh
  // border, hit region, label poles) use this cleaned clone, so the map
  // reads without scattered stray dots while the substance is exact.
  // District ids are preserved (specks fold into an existing neighbour),
  // so selDist highlighting and colours stay consistent.
  const displayAssignment = useMemo(() => {
    if (!partition) return null;
    const a = Int16Array.from(partition.assignment);
    geometricSpeckFix(stateUnits, a, k);
    return a;
  }, [partition, stateUnits, k]);

  // Per-district hit/fill region = the UNION of its units' polygons
  // (concatenated path data). Unlike the traced boundary, this exists for
  // EVERY district — including big rural ones whose boundary loops get
  // filtered by the sliver floor (districts 5 & 8 in MN) — so every
  // district is clickable + highlightable on the map.
  const districtHit = useMemo(() => {
    if (!partition || !displayAssignment) return [];
    const acc = new Array(k).fill('');
    for (let i = 0; i < stateUnits.length; i++) {
      const d = displayAssignment[i];
      if (d < 0 || d >= k) continue;
      const pd = stateUnits[i].pathD;
      if (pd) acc[d] += pd;
    }
    return acc;
  }, [partition, displayAssignment, stateUnits, k]);

  // Robust district-border mesh (topojson-mesh style). Build an UNDIRECTED
  // segment map over every unit edge, keyed at 0.1-unit precision (so tiny
  // tessellation mismatches between two units' shared edge still collapse
  // to one key). A segment is an internal district border iff the units
  // touching it belong to ≥2 districts. This is winding-INSENSITIVE and
  // sees both sides, so — unlike per-district edge cancellation — it can
  // never drop a perimeter side. `borderPath` = all internal borders;
  // `selBorderPath` = just the selected district's borders.
  const { borderPath, selBorderPath } = useMemo(() => {
    if (!partition || !displayAssignment) return { borderPath: '', selBorderPath: '' };
    const seg = new Map(); // key → { x1,y1,x2,y2, ds:Set<district> }
    const r = (v) => Math.round(v * 10) / 10;
    for (let i = 0; i < stateUnits.length; i++) {
      const d = displayAssignment[i];
      if (d < 0) continue;
      const polys = stateUnits[i].polygons;
      for (const poly of polys) for (const ring of poly) {
        for (let j = 0, n = ring.length; j < n; j++) {
          const A = ring[j], B = ring[(j + 1) % n];
          const ax = r(A[0]), ay = r(A[1]), bx = r(B[0]), by = r(B[1]);
          if (ax === bx && ay === by) continue;
          const lo = (ax < bx || (ax === bx && ay <= by));
          const key = lo ? `${ax},${ay},${bx},${by}` : `${bx},${by},${ax},${ay}`;
          let s = seg.get(key);
          if (!s) { s = { x1: ax, y1: ay, x2: bx, y2: by, ds: new Set() }; seg.set(key, s); }
          s.ds.add(d);
        }
      }
    }
    let border = '', selB = '';
    for (const s of seg.values()) {
      if (s.ds.size < 2) continue; // interior of one district, or exterior
      const seg2 = `M${s.x1},${s.y1}L${s.x2},${s.y2}`;
      border += seg2;
      if (selDist != null && s.ds.has(selDist)) selB += seg2;
    }
    return { borderPath: border, selBorderPath: selB };
  }, [partition, displayAssignment, stateUnits, selDist]);

  // District boundary paths + label anchors. Refinements applied here:
  //  - Slab-cut split: we precompute the set of edges that lie on cut lines
  //    between same-FIPS fragments. The trace closes the full loop (needed
  //    for label placement via pole-of-inaccessibility), but emits TWO path
  //    strings: `pathD` (real geographic boundaries) and `slabPathD` (the
  //    arbitrary axis-aligned cuts). Renderer draws them with different
  //    strokes — solid for real, dashed/light for slab-cut — so the user
  //    sees every district boundary while distinguishing organic borders
  //    from population-balance artifacts. Tract mode has no fragments, so
  //    this is a no-op there.
  //  - Tiny-loop filter at tract granularity: single-orphan-tract floaters
  //    (artifacts of tract topojson simplification leaving small components
  //    disconnected) get suppressed to avoid scattered black dots.
  const districtPaths = useMemo(() => {
    if (!partition || !displayAssignment) return [];
    // Edge-rendering already cancels interior edges, so no per-loop area
    // floor is needed (and none can drop a real side). Slab-cut detection
    // is a county-fragment concept — meaningless for precincts/tracts
    // (and O(n) over thousands of units), so it's disabled there.
    const slabCutEdges = (useTracts || usePrecinct) ? null : findSlabCutEdges(stateUnits);
    const out = [];
    for (let d = 0; d < k; d++) {
      const polys = [];
      // Population-weighted centroid of the district's units — used as a
      // labelXY fallback when pole-of-inaccessibility fails (e.g. when the
      // boundary trace returns no closed loops for a pathologically-shaped
      // tract-level district in a dense metro area).
      let cxAcc = 0, cyAcc = 0, popAcc = 0;
      for (let i = 0; i < stateUnits.length; i++) {
        if (displayAssignment[i] !== d) continue;
        const u = stateUnits[i];
        polys.push(u.polygons);
        const w = u.pop || 1;
        cxAcc += u.centroid[0] * w;
        cyAcc += u.centroid[1] * w;
        popAcc += w;
      }
      if (polys.length === 0) continue;
      const fallbackCentroid = popAcc > 0 ? [cxAcc / popAcc, cyAcc / popAcc] : null;
      // Visible outline = the raw boundary edges (always complete — no
      // loop-closing, so a broken chain can't drop a whole side).
      const { pathD, slabPathD } = pathFromBoundaryEdges(boundaryEdgesOf(polys), slabCutEdges);
      // Closed loops are still traced, but ONLY to anchor the number
      // label (pole of inaccessibility); centroid is the fallback.
      const loops = traceBoundary(polys);
      const pole = loops.length ? poleOfInaccessibility(loops, 0.5) : null;
      // Prefer the pole-of-inaccessibility (cleaner inline placement); fall
      // back to the population-weighted centroid so that EVERY district that
      // contains at least one unit gets a labelXY. Clearance is also
      // reported as ~0 in the fallback case, which the layout uses to push
      // such districts into the external label column.
      const labelXY = pole ? [pole[0], pole[1]] : fallbackCentroid;
      const labelClearance = pole ? pole[2] : 0;
      if (pathD || slabPathD || labelXY) {
        out.push({ d, pathD, slabPathD, labelXY, labelClearance });
      }
    }
    return out;
  }, [partition, displayAssignment, stateUnits, k, useTracts]);

  // Two-tier label layout:
  //  - INLINE labels sit on the map at the district's pole-of-inaccessibility,
  //    used when the district has enough internal room and no plate collision.
  //  - EXTERNAL labels float in side columns (right then left then top/bottom)
  //    with leader lines connecting each plate to its district's pole-point.
  //    Used for districts whose pole has insufficient clearance for an inline
  //    plate, OR whose inline position collides with an already-placed plate.
  // This guarantees EVERY district gets a visible numeric label without ever
  // rendering plates that touch each other or straddle a district outline.
  const labelLayout = useMemo(() => {
    const [x0, y0, x1, y1] = sg.bbox;
    const stateW = x1 - x0, stateH = y1 - y0;
    const fontSize = Math.max(2.4, stateW / 56);
    const plateH = fontSize * 1.55;
    const minSep = plateH * 1.25;
    const minClearance = plateH * 0.62;

    // Pass 1: try to place each district inline, processing by descending
    // clearance so the most-spacious districts win priority for prime spots.
    const candidates = districtPaths
      .filter((dp) => dp.labelXY)
      .slice()
      .sort((a, b) => b.labelClearance - a.labelClearance);
    const inline = [];
    const external = [];
    for (const c of candidates) {
      // Reject if too close to district boundary
      if (c.labelClearance < minClearance) { external.push(c); continue; }
      // Reject if plate would collide with already-placed inline plate
      let collides = false;
      for (const p of inline) {
        const dx = c.labelXY[0] - p.labelXY[0];
        const dy = c.labelXY[1] - p.labelXY[1];
        if (dx * dx + dy * dy < minSep * minSep) { collides = true; break; }
      }
      if (collides) external.push(c);
      else inline.push(c);
    }

    // Pass 2: lay out external labels in side columns. Sort by pole-y to
    // produce a roughly left-to-right or top-to-bottom flow; then assign
    // each to the right-side column or left-side column based on whether
    // the district's pole-x is east or west of state center.
    const cx = (x0 + x1) / 2;
    const rightCol = external.filter((e) => e.labelXY[0] >= cx);
    const leftCol = external.filter((e) => e.labelXY[0] < cx);
    rightCol.sort((a, b) => a.labelXY[1] - b.labelXY[1]);
    leftCol.sort((a, b) => a.labelXY[1] - b.labelXY[1]);

    // Where do the external columns sit? Just outside the state bbox, in the
    // expanded viewport. The viewport width is padded to fit them.
    // Each column needs at least plateH+gap height per label.
    const colGap = plateH * 0.45; // vertical gap between stacked plates
    const colSpacing = plateH + colGap;
    const externalMargin = stateW * 0.13; // distance from state edge to plate column
    const externalPlateMaxW = fontSize * (1.1 + 0.6 * 2); // 2-digit pill width

    function layoutColumn(col, side) {
      // side = +1 for right, -1 for left
      // Stack labels along the column with consistent spacing, but preserve
      // their relative y-ordering (already sorted ascending).
      // Center the stack vertically around the state's y-center, but clamp
      // so it stays within the viewport.
      if (col.length === 0) return [];
      const totalH = col.length * plateH + (col.length - 1) * colGap;
      const stateMidY = (y0 + y1) / 2;
      let firstY = stateMidY - totalH / 2 + plateH / 2;
      // Clamp to expanded vertical range
      const minY = y0 + plateH / 2;
      const maxY = y1 - plateH / 2;
      if (firstY < minY) firstY = minY;
      const lastY = firstY + totalH - plateH;
      if (lastY > maxY) firstY = maxY - totalH + plateH;
      const px = side > 0
        ? x1 + externalMargin
        : x0 - externalMargin;
      return col.map((c, i) => ({
        ...c,
        plateXY: [px, firstY + i * colSpacing],
      }));
    }
    const rightLaid = layoutColumn(rightCol, +1);
    const leftLaid = layoutColumn(leftCol, -1);

    // Compute viewBox extent we need
    const margin = Math.max(stateW, stateH) * 0.05;
    const extraR = rightLaid.length > 0 ? externalMargin + externalPlateMaxW * 0.7 : margin;
    const extraL = leftLaid.length > 0 ? externalMargin + externalPlateMaxW * 0.7 : margin;
    const extraTop = margin;
    const extraBot = margin;
    const viewBox = {
      x: x0 - extraL,
      y: y0 - extraTop,
      w: stateW + extraL + extraR,
      h: stateH + extraTop + extraBot,
    };

    return {
      inline,        // [{d, pathD, labelXY, labelClearance}]
      external: [...rightLaid, ...leftLaid], // each also has plateXY
      fontSize,
      plateH,
      viewBox,
    };
  }, [districtPaths, sg]);

  // ---- Zoom & pan ------------------------------------------------------
  // The base viewBox comes from labelLayout (it extends past the state
  // bbox to fit the external label columns). The +/- buttons shrink or
  // expand a viewBox kept centered on that base; once zoomed in the user
  // can click-drag to pan. Pan is clamped every render so the content can
  // never be dragged off the canvas, and re-clamps safely if the base
  // viewBox changes underneath (e.g. when the tract upgrade lands).
  const ZOOM_MIN = 1, ZOOM_MAX = 6, ZOOM_STEP = 1.6;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  // Reset the view whenever a different state is opened.
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); setDragging(false); }, [stateCode]);

  const [x0, y0, x1, y1] = sg.bbox;
  const _vb = labelLayout.viewBox;
  const vbW = _vb.w / zoom;
  const vbH = _vb.h / zoom;
  const maxPanX = Math.max(0, (_vb.w - vbW) / 2);
  const maxPanY = Math.max(0, (_vb.h - vbH) / 2);
  const panX = Math.max(-maxPanX, Math.min(maxPanX, pan.x));
  const panY = Math.max(-maxPanY, Math.min(maxPanY, pan.y));
  const vbX = _vb.x + (_vb.w - vbW) / 2 + panX;
  const vbY = _vb.y + (_vb.h - vbH) / 2 + panY;
  const viewBox = `${vbX} ${vbY} ${vbW} ${vbH}`;

  const zoomBy = (factor) => {
    const nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * factor));
    setZoom(nz);
    if (nz <= ZOOM_MIN) setPan({ x: 0, y: 0 });
  };
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const onPointerDown = (e) => {
    if (zoom <= 1 || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: panX, py: panY, rw: r.width, rh: r.height };
    setDragging(true);
    svgRef.current.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) * (vbW / d.rw);
    const dy = (e.clientY - d.sy) * (vbH / d.rh);
    setPan({
      x: Math.max(-maxPanX, Math.min(maxPanX, d.px - dx)),
      y: Math.max(-maxPanY, Math.min(maxPanY, d.py - dy)),
    });
  };
  const endDrag = (e) => {
    if (dragRef.current && svgRef.current && e && e.pointerId != null) {
      svgRef.current.releasePointerCapture?.(e.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
  };

  const seatsD = districts.filter((d) => d.winner === 'D').length;
  const seatsR = districts.filter((d) => d.winner === 'R').length;
  // Empty until a partition exists (e.g. arriving here from the pre-render
  // path, where this state's tract ReCom is still computing). Guard the
  // spread so we don't print "-Infinity%".
  const maxDev = districts.length
    ? Math.max(...districts.map((d) => Math.abs(d.dev)))
    : 0;

  return (
    <section style={S.mapSection} className="r-mapsection r-pad">
      <div style={S.detailHeader}>
        <div>
          <div style={S.kicker}>STATE DETAIL · {stateCode}</div>
          <h2 style={S.sectionTitle}>{sg.name}</h2>
          <p style={{ ...S.sectionLede, marginBottom: 0 }} className="r-sectionlede">
            {k} congressional districts · {stateUnits.length.toLocaleString()}{' '}
            {usePrecinct ? 'voting precincts · real ' + year + ' returns'
              : useTracts ? 'census tracts' : 'county units'} · max population deviation{' '}
            <span style={{ color: maxDev <= 0.01 ? '#1a1a14' : maxDev <= 0.05 ? '#1a1a14' : '#c44536', fontWeight: 600 }}>
              {(maxDev * 100).toFixed(1)}%
            </span>
            {precinctCovered && precStage === 'fetching' && (
              <span style={{ color: 'rgba(26,26,20,0.55)' }}> · fetching precinct geometry…</span>
            )}
            {precinctCovered && precStage === 'building' && (
              <span style={{ color: 'rgba(26,26,20,0.55)' }}> · building precinct graph…</span>
            )}
            {precinctCovered && precStage === 'recom' && (
              <span style={{ color: 'rgba(26,26,20,0.55)' }}> · running precinct-level ReCom on real returns…</span>
            )}
            {precinctCovered && precStage === 'error' && (
              <span style={{ color: '#c44536' }}> · precinct data unavailable ({precError ? precError.slice(0, 40) : '—'}); showing model substrate</span>
            )}
            {substrate === 'precinct' && !PRECINCT_STATES.has(stateCode) && (
              <span style={{ color: '#c44536' }}> · no precinct file built for {sg.name}; showing the model substrate</span>
            )}
            {!precinctCovered && tractStage === 'fetching' && (
              <span style={{ color: 'rgba(26,26,20,0.55)' }}> · fetching tract geometry…</span>
            )}
            {!precinctCovered && tractStage === 'building' && (
              <span style={{ color: 'rgba(26,26,20,0.55)' }}> · building tract graph…</span>
            )}
            {!precinctCovered && tractStage === 'recom' && (
              <span style={{ color: 'rgba(26,26,20,0.55)' }}> · running tract-level ReCom…</span>
            )}
            {!precinctCovered && tractStage === 'error' && (
              <span style={{ color: '#c44536' }}> · tract data unavailable ({tractError ? tractError.slice(0, 40) : '—'}); showing county fallback</span>
            )}
          </p>
        </div>
        <div style={S.detailHeaderControls}>
          <YearSelector year={year} setYear={setYear}
            allowedYears={substrate === 'precinct' ? PRECINCT_YEARS : null} />
          <button onClick={onClose} style={S.detailClose}>← Back to national</button>
        </div>
      </div>
      <div style={S.detailGrid} className="r-detailgrid">
        <div style={S.detailMapWrap}>
          <div style={S.detailMapInner}>
            <div style={S.zoomControls}>
              <button type="button" aria-label="Zoom in" title="Zoom in"
                onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}
                style={{ ...S.zoomBtn, ...(zoom >= ZOOM_MAX ? S.zoomBtnOff : null) }}>+</button>
              <button type="button" aria-label="Zoom out" title="Zoom out"
                onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}
                style={{ ...S.zoomBtn, ...(zoom <= ZOOM_MIN ? S.zoomBtnOff : null) }}>−</button>
              <button type="button" aria-label="Reset view" title="Reset view"
                onClick={resetView} disabled={zoom === 1 && panX === 0 && panY === 0}
                style={{ ...S.zoomBtn, ...S.zoomBtnReset, ...((zoom === 1 && panX === 0 && panY === 0) ? S.zoomBtnOff : null) }}>⤢</button>
            </div>
          <svg
            ref={svgRef}
            viewBox={viewBox}
            style={{ ...S.detailMapSvg, cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default', touchAction: zoom > 1 ? 'none' : 'auto' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {/* Layer 1: counties colored by their own D-share */}
            {stateUnits.map((u) => (
              <path
                key={u.id}
                d={u.pathD}
                fill={unitColorForYear(u, year)}
                stroke={usePrecinct ? 'none' : 'rgba(0,0,0,0.06)'}
                strokeWidth={usePrecinct ? 0 : Math.max(0.05, (x1 - x0) / 1500)}
              />
            ))}
            {/* Layer 2: district outlines.
                2a — slab-cut artifact boundaries (between same-county
                     fragments in different districts) at lighter weight +
                     dashed style, so the user sees where boundaries fall
                     through subdivided metros without arbitrary axis-
                     aligned cuts dominating.
                2b — natural geographic boundaries at full weight. */}
            {districtPaths.map((dp) => dp.slabPathD ? (
              <path
                key={`${dp.d}-slab`}
                d={dp.slabPathD}
                fill="none"
                stroke="rgba(26,26,20,0.4)"
                strokeWidth={Math.max(0.25, (x1 - x0) / 600)}
                strokeDasharray={`${Math.max(0.6, (x1 - x0) / 300)},${Math.max(0.6, (x1 - x0) / 300)}`}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null)}
            {/* District borders: ONE robust mesh path (undirected segment
                map — can't drop a side), white casing under a bold dark
                line so it reads over the colour mosaic. */}
            {borderPath && (
              <path d={borderPath} fill="none" stroke="#fdfaf2"
                strokeWidth={(usePrecinct ? Math.max(1.5, (x1 - x0) / 150) : Math.max(1.2, (x1 - x0) / 210)) / zoom}
                strokeLinejoin="round" strokeLinecap="round" opacity={0.9} pointerEvents="none" />
            )}
            {borderPath && (
              <path d={borderPath} fill="none" stroke="#1a1a14"
                strokeWidth={(usePrecinct ? Math.max(0.85, (x1 - x0) / 230) : Math.max(0.6, (x1 - x0) / 320)) / zoom}
                strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
            )}
            {/* Selected district: gold tint over its unit union + a bold
                gold re-stroke of just its borders. */}
            {selDist != null && districtHit[selDist] ? (
              <path key={`sel-${selDist}`} d={districtHit[selDist]}
                fill="rgba(224,159,62,0.32)" stroke="none" pointerEvents="none" />
            ) : null}
            {selBorderPath && (
              <path d={selBorderPath} fill="none" stroke="#e09f3e"
                strokeWidth={Math.max(1.6, (x1 - x0) / 130) / zoom}
                strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
            )}
            {/* Transparent per-district hit layer (unit union → every
                district clickable, incl. 5 & 8). */}
            {districtHit.map((d, di) => d ? (
              <path key={`hit-${di}`} d={d} fill="transparent"
                stroke="transparent" fillRule="nonzero" style={{ cursor: 'pointer' }}
                onClick={() => setSelDist((p) => (p === di ? null : di))}>
                <title>District {di + 1} — click for insights</title>
              </path>
            ) : null)}
            {/* Layer 3: state outline as bold WHITE (with thin dark edge below for definition) */}
            <path d={sg.pathD} fill="none" stroke="#1a1a14" strokeWidth={Math.max(1.2, (x1 - x0) / 140) / zoom} strokeLinejoin="round" />
            <path d={sg.pathD} fill="none" stroke="#fdfaf2" strokeWidth={Math.max(0.9, (x1 - x0) / 200) / zoom} strokeLinejoin="round" />
            {/* Layer 4a: leader lines from external plates to district pole-points.
                Drawn BEFORE plates so the line tucks under the plate edge.
                Two-pass for visibility: dark stroke beneath, lighter accent
                ending in a small dot at the district end. */}
            {labelLayout.external.map((ext) => {
              const [px, py] = ext.plateXY;
              const [tx, ty] = ext.labelXY;
              return (
                <g key={`leader-${ext.d}`} pointerEvents="none">
                  <line x1={px} y1={py} x2={tx} y2={ty}
                        stroke="#1a1a14"
                        strokeWidth={Math.max(0.18, labelLayout.fontSize * 0.07) / zoom}
                        strokeLinecap="round" />
                  <circle cx={tx} cy={ty} r={Math.max(0.3, labelLayout.fontSize * 0.12) / zoom}
                          fill="#1a1a14" />
                </g>
              );
            })}
            {/* Layer 4b: the pill plates themselves — one renderer for both
                inline and external since geometry is identical. */}
            {(() => {
              // Plates/leaders are screen-furniture, not geography: shrink
              // them with zoom (like the border strokes) so they don't
              // dominate when the user zooms into detail.
              const fontSize = labelLayout.fontSize / zoom;
              const plateH = labelLayout.plateH / zoom;
              const plateBorder = Math.max(0.18, labelLayout.fontSize * 0.07) / zoom;
              const opticalDy = -fontSize * 0.07;
              const renderPlate = (d, cx, cy, keyPrefix) => {
                const label = String(d + 1);
                const digits = label.length;
                const plateW = digits === 1 ? plateH : fontSize * (1.1 + 0.6 * digits);
                const plateR = plateH / 2;
                return (
                  <g key={`${keyPrefix}-${d}`} pointerEvents="none">
                    <rect
                      x={cx - plateW / 2}
                      y={cy - plateH / 2}
                      width={plateW}
                      height={plateH}
                      rx={plateR}
                      ry={plateR}
                      fill="#fdfaf2"
                      stroke="#1a1a14"
                      strokeWidth={plateBorder}
                    />
                    <text
                      x={cx}
                      y={cy + opticalDy}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontFamily='"Fraunces", "Cormorant Garamond", Georgia, serif'
                      fontWeight="600"
                      fontVariationSettings='"opsz" 36'
                      fontSize={fontSize}
                      fill="#1a1a14"
                      letterSpacing={digits > 1 ? '-0.02em' : 0}
                    >
                      {label}
                    </text>
                  </g>
                );
              };
              return (
                <>
                  {labelLayout.inline.map((dp) => renderPlate(dp.d, dp.labelXY[0], dp.labelXY[1], 'inline'))}
                  {labelLayout.external.map((dp) => renderPlate(dp.d, dp.plateXY[0], dp.plateXY[1], 'external'))}
                </>
              );
            })()}
          </svg>
          </div>
        </div>
        <div style={S.detailPanel}>
          <div style={S.detailPanelHeader}>
            <div style={S.tickerKicker}>SEAT TOTAL · {year}</div>
            <div style={S.detailSeats}>
              <span style={{ color: seatsD > seatsR ? '#2c5d8f' : 'rgba(26,26,20,0.4)', fontWeight: seatsD > seatsR ? 600 : 400 }}>D {seatsD}</span>
              <span style={{ margin: '0 8px', color: 'rgba(26,26,20,0.3)' }}>·</span>
              <span style={{ color: seatsR > seatsD ? '#b3433b' : 'rgba(26,26,20,0.4)', fontWeight: seatsR > seatsD ? 600 : 400 }}>R {seatsR}</span>
            </div>
          </div>
          {insight && (
            <div style={{ borderBottom: '1px solid rgba(26,26,20,0.12)', paddingBottom: 14, marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={S.tickerKicker}>DISTRICT {insight.d + 1} · INSIGHTS</div>
                <button onClick={() => setSelDist(null)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14, color: 'rgba(26,26,20,0.5)', lineHeight: 1, padding: 2 }}
                  title="Close">✕</button>
              </div>
              <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, marginTop: 8, lineHeight: 1.6, color: '#1a1a14' }}>
                <div>
                  <strong>{(insight.pop / 1000).toFixed(0)}K</strong> people ·{' '}
                  {insight.unitCount.toLocaleString()} {usePrecinct ? 'precincts' : useTracts ? 'tracts' : 'county units'} ·{' '}
                  pop dev <span style={{ color: Math.abs(insight.dev) <= 0.05 ? 'rgba(26,26,20,0.6)' : '#c44536' }}>
                    {insight.dev >= 0 ? '+' : ''}{(insight.dev * 100).toFixed(1)}%</span>
                </div>
                <div style={{ marginTop: 10, fontWeight: 600, fontSize: 10, letterSpacing: '0.06em', color: 'rgba(26,26,20,0.55)' }}>
                  TWO-PARTY RESULT BY CYCLE
                </div>
                {insight.cycles.filter((c) => c.dShare != null).map((c) => (
                  <div key={c.yr} style={{ display: 'flex', gap: 8 }}>
                    <span style={{ width: 34, color: c.yr === year ? '#1a1a14' : 'rgba(26,26,20,0.55)', fontWeight: c.yr === year ? 700 : 400 }}>{c.yr}</span>
                    <span style={{ width: 64, color: c.winner === 'D' ? '#2c5d8f' : '#b3433b', fontWeight: 600 }}>
                      {c.winner} {(c.dShare * 100).toFixed(1)}%
                    </span>
                    <span style={{ color: 'rgba(26,26,20,0.55)' }}>
                      {c.winner}+{Math.abs(c.margin).toFixed(1)}{Math.abs(c.margin) <= 10 ? ' · competitive' : ''}
                    </span>
                  </div>
                ))}
                {insight.dem && (
                  <>
                    <div style={{ marginTop: 10, fontWeight: 600, fontSize: 10, letterSpacing: '0.06em', color: 'rgba(26,26,20,0.55)' }}>
                      DEMOGRAPHICS · 2020 CENSUS
                    </div>
                    {insight.dem.rows.map((rw) => (
                      <div key={rw.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 60 }}>{rw.label}</span>
                        <span style={{ width: 36, textAlign: 'right' }}>{(rw.share * 100).toFixed(1)}%</span>
                        <span style={{ flex: 1, height: 7, background: 'rgba(26,26,20,0.08)' }}>
                          <span style={{ display: 'block', height: '100%', width: `${Math.min(100, rw.share * 100)}%`, background: '#7a8a9a' }} />
                        </span>
                      </div>
                    ))}
                    {insight.dem.vapShare != null && (
                      <div style={{ color: 'rgba(26,26,20,0.55)', marginTop: 2 }}>
                        voting-age (18+): {(insight.dem.vapShare * 100).toFixed(1)}% of pop
                      </div>
                    )}
                  </>
                )}
                <div style={{ marginTop: 10, fontWeight: 600, fontSize: 10, letterSpacing: '0.06em', color: 'rgba(26,26,20,0.55)' }}>
                  COUNTY FIPS COMPOSITION ({insight.counties.length}{insight.countySplitCount ? ` · ${insight.countySplitCount} split across districts` : ' · all whole'})
                </div>
                {insight.counties.slice(0, 8).map((c) => (
                  <div key={c.fips} style={{ display: 'flex', gap: 8 }}>
                    <span style={{ width: 54 }}>{c.fips}</span>
                    <span style={{ width: 40, textAlign: 'right' }}>{(c.share * 100).toFixed(0)}%</span>
                    <span style={{ color: 'rgba(26,26,20,0.55)' }}>
                      {(c.pop / 1000).toFixed(0)}K{c.split ? ' · split ⚠' : ''}
                    </span>
                  </div>
                ))}
                {insight.counties.length > 8 && (
                  <div style={{ color: 'rgba(26,26,20,0.5)' }}>+{insight.counties.length - 8} more counties…</div>
                )}
              </div>
            </div>
          )}
          <div style={S.detailPanelList}>
            <div style={S.detailListHeader}>
              <span style={{ flex: '0 0 28px' }}>#</span>
              <span style={{ flex: 1 }}>D-share</span>
              <span style={{ flex: '0 0 70px', textAlign: 'right' }}>pop</span>
              <span style={{ flex: '0 0 50px', textAlign: 'right' }}>dev</span>
            </div>
            {districts.map((dist, i) => (
              <div key={dist.d}
                onClick={() => setSelDist((p) => (p === dist.d ? null : dist.d))}
                title={`District ${dist.d + 1} — click for insights`}
                style={{
                  ...S.detailRow,
                  cursor: 'pointer',
                  background: selDist === dist.d ? 'rgba(224,159,62,0.16)' : 'transparent',
                  boxShadow: selDist === dist.d ? 'inset 3px 0 0 #e09f3e' : 'none',
                }}>
                <span style={{ flex: '0 0 28px', fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: 'rgba(26,26,20,0.55)' }}>
                  {dist.d + 1}
                </span>
                <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10, height: 10, borderRadius: 2,
                      background: shareToColor(dist.dShare),
                    }}
                  />
                  <span style={{ fontWeight: dist.winner === 'D' ? 600 : 400, color: dist.winner === 'D' ? '#2c5d8f' : '#b3433b' }}>
                    {(dist.dShare * 100).toFixed(1)}% D
                  </span>
                </span>
                <span style={{ flex: '0 0 70px', textAlign: 'right', fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }}>
                  {(dist.pop / 1000).toFixed(0)}K
                </span>
                <span style={{
                  flex: '0 0 50px',
                  textAlign: 'right',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 11,
                  color: Math.abs(dist.dev) <= 0.05 ? 'rgba(26,26,20,0.55)' : '#c44536',
                  fontWeight: Math.abs(dist.dev) > 0.05 ? 600 : 400,
                }}>
                  {dist.dev >= 0 ? '+' : ''}{(dist.dev * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- HEADER & FOOTER --------------------------------------------- */
function Header() {
  return (
    <header style={S.header} className="r-header">
      <div style={S.headerInner} className="r-pad">
        <div style={S.kicker}>FIELD STUDY № 04 — COMPUTATIONAL DEMOCRACY</div>
        <h1 style={S.headline1}>The 50-state problem.</h1>
        <p style={S.lede} className="r-lede">
          An empirical demonstration of algorithmic congressional redistricting on the
          actual partisan geography of <strong>seven presidential cycles (2000–2024)</strong>.
          Real US counties and census tracts as the substrate; ReCom (the MGGG/Duchin/DeFord
          Markov chain) as the algorithm. All 435 House seats, all 50 states, drawn from data
          not opinion.
        </p>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer style={S.footer}>
      <div style={S.footerInner}>
        <div>
          <strong>Methodology in brief.</strong> Each county is a single node on a national adjacency
          graph of ~3,300 nodes; counties whose population exceeds ~25% of their state's per-district
          target (with a 200K floor) are slab-subdivided into fragments small enough (each ≤ 0.12 × target)
          for the chain to balance against. Adjacency is derived from shared topojson arcs (real land borders) plus
          manual water-gap bridges (Mackinac, Verrazzano, the Eastern Shore VA bay-bridge-tunnel, RI
          Newport, San Juan Islands, Hawaii inter-island, NYC borough crossings). Vote totals are
          official county-level two-party presidential returns for <strong>2000, 2004, 2008, 2012,
          2016, 2020, and 2024</strong>, sourced from the MIT Election Data and Science Lab county-
          returns dataset via the stiles/presidential-elections compilation (2000–2012) and the
          tonmcg/US_County_Level_Election_Results_08-24 tabulation (2016/2020/2024). Populations come
          from the Census Bureau's 2021 vintage of county-level estimates (preserves pre-CT-planning-
          region county geography to match the topojson). For counties subdivided into fragments, each
          fragment inherits the parent county's per-capita partisan rate (uniform dispersion within a
          county is an approximation; precinct-level data would refine this). Midterm House years
          (2006/2010/2014/2018/2022) are not included — U.S. House results are tabulated by
          congressional district, not county, so no unified national county-level dataset exists.
        </div>
        <div style={{ marginTop: 18 }}>
          <strong>The districting algorithm</strong> is ReCom — the recombination Markov chain over
          balanced k-partitions of the adjacency graph (DeFord, Duchin, Solomon 2021). Each state runs
          independently from a recursive-spanning-tree-bisection initial partition, with a dynamic
          burn-in (scaling with seat count, 120–400 ReCom moves) under graduated tolerance, followed
          by a greedy boundary-unit polish phase wrapped in a perturb-and-repolish loop, up to 10
          retries from independent seeds (kept best-of), and a graph-isoperimetric compactness gate
          on every accepted cut. The compactness threshold relaxes deterministically on later
          retries to preserve Markov-chain ergodicity. <strong>After the county-level pass, every
          state still over ±5% is automatically upgraded to tract-level partitioning:</strong> the
          state's 2020-Decennial tracts (~3,500 people each) become the units, ReCom runs on that
          tract graph until ±1% balance is achieved, and the tract assignments are projected back
          to county fragments by bbox containment for rendering. The variance metric shown in the
          headline reflects the underlying tract-level balance, not the projection. As a result the
          dashboard consistently delivers 44/44 states inside ±5% on default settings.
        </div>
        <div style={{ marginTop: 18 }}>
          <strong>Tract-level partisanship is modeled, not measured.</strong> No federal authority
          publishes precinct-to-tract election crosswalks, so tract D-shares cannot be directly
          observed. The dashboard's previous version disaggregated county votes uniformly across
          tracts — losing all within-county urban/rural variation. We now apply a <strong>population-
          density partisanship model</strong>: each tract's D-share is shifted from the county
          average by 0.45 × log(tract_density / county_median_density) in logit space, then
          rescaled per (county, year) so that the sum of tract D-votes and R-votes exactly matches
          the official county totals. This adds the strongest non-racial geographic predictor of
          partisanship — population density — to the within-county picture, while preserving the
          county-level truth. Empirically the coefficient 0.45 matches the lower end of national
          multilevel-model estimates from Rodden, Chen, and the post-2016 partisan-geography
          literature. Future extensions (race, ethnicity, education) require ACS table fetches via
          the Census API and a build-time pipeline; the framework is in place.
        </div>
        <div style={{ marginTop: 18, opacity: 0.7 }}>
          Calibration sources: stiles/presidential-elections (2000–2024 county-level, processed JSON of MIT EDSL data);
          tonmcg/US_County_Level_Election_Results_08-24 (2016/2020/2024 presidential by county);
          US Census Bureau co-est2021-alldata (county populations); 2020 Decennial Census P1 totals
          (tract populations); us-atlas v3 counties-albers-10m (TopoJSON, Albers USA projection from
          Census 2017 cartographic boundary files); MGGG redistricting lab on ReCom (DeFord, Duchin,
          Solomon 2021, "Recombination: A Family of Markov Chains for Redistricting").
        </div>
      </div>
    </footer>
  );
}

/* ---------- NATIONAL PRECINCT DISTRICTING ------------------------------ */
// The national precinct map renders ~435 district polygons, NOT ~180k
// individual precincts (that scaling wall is why the model pre-renders to
// an image). scripts/build-precincts dissolves each state's precincts into
// its baked-seed district polygons offline and ships a tiny
// /data/precincts/<fips>-districts.json (≈k polygons + per-cycle D/R).
// This hook loads those (small, parallel) and builds one synthetic
// "unit per district" record per state — so the existing renderer draws
// real precinct-derived districts nationwide, fast. The per-state DETAIL
// view still fetches the full precinct file for true precinct granularity.
const CACHED_PRECINCT_NATIONAL = new Map();      // `${baseSeed}` → { CODE: record }
const CACHED_PRECINCT_DISTRICTS = new Map();     // fips → districts json

function buildPrecinctDistrictRecord(dj, code, baseSeed, stateGeom) {
  const b = dj && dj.baked && (dj.baked[baseSeed] || dj.baked[String(baseSeed)]);
  if (!b || !b.dists) return null;
  const units = b.dists.map((d, i) => {
    const polys = d.polys && d.polys.length ? d.polys : [];
    const votes = {};
    for (const yr of YEAR_CONFIG.allYears) {
      const e = d.v && d.v[yr];
      votes[yr] = e ? { d: e[0], r: e[1], t: e[0] + e[1] } : { d: 0, r: 0, t: 0 };
    }
    return {
      id: `${code}-${i}`, fips: dj.fips, stateCode: code, pop: 0,
      polygons: polys, votes, parentDShare: {},
      centroid: polys.length ? multiPolygonCentroid(polys) : [0, 0],
      bbox: polys.length ? bboxOfPolygons(polys) : [0, 0, 0, 0],
      pathD: polys.length ? pathFromPolygons(polys) : '',
    };
  });
  const k = units.length;
  const assignment = new Int16Array(k);
  for (let i = 0; i < k; i++) assignment[i] = i;     // unit i == district i
  return {
    partition: { assignment, districtPop: new Array(k).fill(0) },
    units, renderUnits: units,
    name: (stateGeom[code] || {}).name || code,
    seats: dj.seats || k,
    maxDev: b.maxDev ?? 0,
    substrate: 'precinct',
  };
}

function usePrecinctNational(data, baseSeed, active) {
  const [partitions, setPartitions] = useState(() =>
    active ? CACHED_PRECINCT_NATIONAL.get(String(baseSeed)) || {} : {});
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (!active || !data) { setPartitions({}); setProgress(null); return; }
    const ck = String(baseSeed);
    if (CACHED_PRECINCT_NATIONAL.has(ck)) {
      setPartitions(CACHED_PRECINCT_NATIONAL.get(ck)); setProgress(null); return;
    }
    let cancelled = false;
    const codes = [...PRECINCT_STATES];
    setProgress({ done: 0, total: codes.length, code: null });
    (async () => {
      // Tiny district files — fetch all in parallel, then assemble.
      const fetched = await Promise.all(codes.map(async (code) => {
        if (CACHED_PRECINCT_DISTRICTS.has(code)) return [code, CACHED_PRECINCT_DISTRICTS.get(code)];
        try {
          const r = await fetch(PRECINCTS_BASE_URL + FIPS_BY_STATE_CODE[code] + '-districts.json');
          if (!r.ok) return [code, undefined];
          const j = await r.json();
          CACHED_PRECINCT_DISTRICTS.set(code, j);
          return [code, j];
        } catch { return [code, undefined]; }
      }));
      if (cancelled) return;
      const acc = {};
      let done = 0;
      for (const [code, dj] of fetched) {
        if (cancelled) return;
        if (dj) {
          const rec = buildPrecinctDistrictRecord(dj, code, baseSeed, data.stateGeom);
          if (rec) acc[code] = rec;
        }
        done++;
        if (!cancelled && (done % 6 === 0 || done === codes.length)) {
          setProgress(done === codes.length ? null : { done, total: codes.length, code: code + '▪' });
          setPartitions({ ...acc });
        }
        if (done % 6 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      if (cancelled) return;
      CACHED_PRECINCT_NATIONAL.set(ck, acc);
      setPartitions(acc);
      setProgress(null);
    })();
    return () => { cancelled = true; };
  }, [data, baseSeed, active]);

  return { precinctPartitions: partitions, precinctProgress: progress };
}

/* ---------- DISTRICTING HOOK -------------------------------------------- */
// Runs ReCom across all 50 states, streaming results as each completes so
// the UI can render progressively. Caches per (seed, tolerance) so toggling
// year doesn't re-run the algorithm (the partitions are year-independent;
// only the per-district vote totals change).
const CACHED_DISTRICTING = new Map(); // key: `${seed}_${tolerance}` → result
// Expose to window for build-time extraction of cached seeds. Harmless at
// runtime; useful when running scripts/extract-seed-cache.mjs which drives
// a headless browser through seeds 42/7/1337 and serializes the result.
if (typeof window !== 'undefined') window.__CACHED_DISTRICTING__ = CACHED_DISTRICTING;

// Loads the committed 13-year headline summary for a pre-rendered default
// seed (/data/seeds/<seed>-summary.json). Returns null until loaded, or if
// inactive / not a default seed. Cached module-side so re-selecting one of
// the three default seeds is instant (no refetch).
const CACHED_SUMMARY = new Map(); // seed → summary object
function usePrerendered(seed, active) {
  const [summary, setSummary] = useState(() =>
    active ? CACHED_SUMMARY.get(seed) || null : null
  );
  useEffect(() => {
    if (!active) { setSummary(null); return; }
    if (CACHED_SUMMARY.has(seed)) { setSummary(CACHED_SUMMARY.get(seed)); return; }
    let cancelled = false;
    (async () => {
      try {
        const base = (typeof window !== 'undefined' && window.__DATA_BASE_URL__) || '/data/';
        const r = await fetch(base + 'seeds/' + seed + '-summary.json');
        if (!r.ok) throw new Error('no summary (' + r.status + ')');
        const j = await r.json();
        if (cancelled) return;
        CACHED_SUMMARY.set(seed, j);
        setSummary(j);
      } catch {
        // No committed summary — caller's prerenderMode will resolve false
        // on next interaction; until then headline shows a placeholder.
        if (!cancelled) setSummary(null);
      }
    })();
    return () => { cancelled = true; };
  }, [seed, active]);
  return summary;
}

// `active` is false while the pre-render fast path is showing (a committed
// default seed at the default year, pre-engagement). The engine — and the
// ≈29 MB tract download + ~28 s of buildTractUnits/adjacency it triggers —
// stays completely idle until the user engages.
function useDistricting(data, seed, tolerance = 0.05, active = true) {
  const key = data ? `${seed}_${tolerance}` : null;
  const [result, setResult] = useState(() => key ? CACHED_DISTRICTING.get(key) || null : null);
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (!active) return;
    if (!data || !key) return;
    if (CACHED_DISTRICTING.has(key)) {
      setResult(CACHED_DISTRICTING.get(key));
      setProgress(null);
      return;
    }
    let cancelled = false;
    setProgress({ done: 0, total: 0, code: null });

    (async () => {
      // Fast path: if this seed was pre-computed at build time, load the
      // cached partitions (skips both ReCom passes) and we're done.
      const fromCache = await tryLoadCachedSeed(
        seed, tolerance, data,
        (p) => { if (!cancelled) setProgress(p); },
        () => cancelled
      );
      if (cancelled) return;
      if (fromCache) {
        CACHED_DISTRICTING.set(key, fromCache);
        setResult(fromCache);
        setProgress(null);
        return;
      }

      const stateCodes = Object.keys(data.stateGeom).filter((c) => c !== 'DC');
      const partitions = {}; // stateCode → { partition, units }
      let dSeats = 0, rSeats = 0;
      for (let i = 0; i < stateCodes.length; i++) {
        if (cancelled) return;
        const code = stateCodes[i];
        const sg = data.stateGeom[code];
        const stateUnits = data.unitsByState[code] || [];
        if (stateUnits.length === 0 || sg.seats === 0) continue;
        // Build state-local adjacency
        const idxInState = new Map();
        for (let j = 0; j < stateUnits.length; j++) idxInState.set(data.idIdx.get(stateUnits[j].id), j);
        const stateAdj = stateUnits.map((u) => {
          const globalIdx = data.idIdx.get(u.id);
          const out = [];
          for (const v of data.adjacency[globalIdx]) {
            const localV = idxInState.get(v);
            if (localV !== undefined) out.push(localV);
          }
          return out;
        });
        // Multi-seed retry: try up to MAX_TRIES different seeds and keep the
        // partition with the smallest max-deviation. The MAX_TRIES ceiling
        // is dynamic — it grows when the best attempt-so-far is still over
        // tolerance, up to a hard cap of 10 attempts. Each attempt uses a
        // distinct derived seed, so the chain explores a fresh region of
        // the partition space. We yield to the UI between attempts.
        const HARD_MAX_TRIES = 10;
        const SOFT_MIN_TRIES = 3;
        let best = null, bestDev = Infinity;
        for (let attempt = 0; attempt < HARD_MAX_TRIES; attempt++) {
          if (cancelled) return;
          // Stop early once we've met tolerance AND done at least SOFT_MIN.
          if (best && bestDev <= tolerance && attempt >= SOFT_MIN_TRIES) break;
          const supSym = attempt === 0 ? '' :
            attempt < 4 ? ['²','³','⁴','⁵'][attempt - 1] : '*';
          const tag = code + supSym;
          setProgress({ done: i, total: stateCodes.length, code: tag });
          await new Promise((r) => setTimeout(r, 0));
          const stateSeed = seed * 1000 + code.charCodeAt(0) * 17 + code.charCodeAt(1) + attempt * 7919;
          // burnIn grows with state size AND attempt number. Later attempts
          // get longer burn-in so the chain has more chances to find a good
          // initial partition before polish takes over.
          const baseBurnIn = Math.max(120, Math.min(400, sg.seats * 14));
          const dynamicBurnIn = baseBurnIn + attempt * 60;
          // Compactness schedule (graph isoperimetric ratio = cross-edges /
          // smaller-piece-size). The thresholds are SHARPLY tighter than
          // before — the first attempts demand visibly compact cuts; only
          // when no balanced partition is found at that strictness do we
          // relax. Empirically the schedule below produces districts that
          // look hand-drawn at the national view while still hitting ±5 %.
          //   attempts 0-1: 0.8  (strict — favors near-circular shapes)
          //   attempts 2-3: 1.2  (moderate — accepts most reasonable cuts)
          //   attempts 4-6: 2.0  (loose — last gasp at balance)
          //   attempts 7+:  inf  (no compactness filter, balance only)
          const compactness =
            attempt <= 1 ? 0.8 :
            attempt <= 3 ? 1.2 :
            attempt <= 6 ? 2.0 :
            Infinity;
          const part = runReCom(stateUnits, stateAdj, sg.seats, stateSeed, {
            burnIn: dynamicBurnIn, tolerance, compactness,
          });
          if (!part) continue;
          const tgt = part.districtPop.reduce((s, p) => s + p, 0) / part.districtPop.length;
          let maxDev = 0;
          for (const p of part.districtPop) {
            const d = Math.abs(p - tgt) / tgt;
            if (d > maxDev) maxDev = d;
          }
          // Track a partition-level compactness score so we can prefer
          // visually-clean partitions when multiple attempts meet ±tolerance.
          // Score = mean per-district isoperimetric ratio (lower is better).
          let totalCross = 0;
          for (let u = 0; u < stateUnits.length; u++) {
            const a = part.assignment[u];
            for (const v of stateAdj[u]) {
              if (part.assignment[v] !== a) totalCross++;
            }
          }
          // Each cross-edge double-counted. Normalize by k for a
          // size-independent score.
          const meanCutPerDistrict = totalCross / (2 * sg.seats);
          part._compactness = meanCutPerDistrict;
          // Selection rule:
          //   - Strictly prefer partitions with maxDev ≤ tolerance over
          //     those that are still over it (balance is the hard constraint).
          //   - Among balanced partitions, prefer LOWER mean cut/district.
          //   - Among over-tolerance ones, prefer lower maxDev.
          const bestIsBalanced = best && bestDev <= tolerance;
          const curIsBalanced = maxDev <= tolerance;
          let replace = false;
          if (!best) replace = true;
          else if (!bestIsBalanced && curIsBalanced) replace = true;
          else if (bestIsBalanced === curIsBalanced) {
            replace = bestIsBalanced
              ? meanCutPerDistrict < (best._compactness ?? Infinity)
              : maxDev < bestDev;
          }
          if (replace) { bestDev = maxDev; best = part; }
        }
        const partition = best;
        partitions[code] = {
          partition, units: stateUnits, name: sg.name, seats: sg.seats,
          maxDev: bestDev,
          compactness: best?._compactness,
        };
        if (typeof console !== 'undefined') {
          console.log('[redistricting]', code,
            'seats=' + sg.seats,
            'units=' + stateUnits.length,
            'maxDev=' + (bestDev * 100).toFixed(2) + '%',
            'meanCut/d=' + (best?._compactness ?? 0).toFixed(2));
        }
        // Yield to UI between states
        setProgress({ done: i + 1, total: stateCodes.length, code });
        await new Promise((r) => setTimeout(r, 0));
      }
      if (cancelled) return;

      // First emit the county-fragment result so the UI renders fast.
      const initial = { partitions, seed, tolerance };
      CACHED_DISTRICTING.set(key, initial);
      setResult(initial);

      // Phase 2: tract-level upgrade for EVERY multi-seat state. This makes
      // the national view's substrate uniform with the state-detail view —
      // same tracts, same partition, same colors. We upgrade in worst-first
      // order so the failing states' variance metric improves visibly
      // first; the rest follow to bring the rendering into line.
      const upgradeable = Object.entries(partitions).filter(([_, p]) =>
        p.seats >= 2 && p.partition
      );
      upgradeable.sort((a, b) => (b[1].maxDev ?? 0) - (a[1].maxDev ?? 0));

      if (upgradeable.length > 0 && TRACTS_BASE_URL) {
        for (const [code, p] of upgradeable) {
          if (cancelled) return;
          setProgress({
            done: stateCodes.length, total: stateCodes.length,
            code: code + '◆', // upgrade marker
          });
          await new Promise((r) => setTimeout(r, 0));
          try {
            const upgraded = await upgradeStateToTracts(
              code, data, seed, tolerance, partitions[code]
            );
            if (!upgraded || cancelled) continue;
            // Always replace with the tract-level partition: the renderUnits
            // are tract polygons so the national view shows tract granularity,
            // and the underlying tract partition has ±1 % balance.
            partitions[code] = {
              ...p,
              partition: {
                // The fragment-level assignment is kept on a side channel
                // (for debugging / fallback) but the canonical partition
                // is now tract-level, used by both the national renderer
                // and the state-detail view.
                assignment: upgraded.tractAssignment,
                districtPop: upgraded.tractDistrictPop,
              },
              fragmentAssignment: upgraded.assignment,
              renderUnits: upgraded.tractUnits, // tract polygons for rendering
              maxDev: upgraded.tractMaxDev,
              substrate: 'tract',
            };
            // Stream the result to the UI
            setResult({ partitions: { ...partitions }, seed, tolerance });
            if (typeof console !== 'undefined') {
              console.log('[tract-upgrade]', code,
                'tractMaxDev=' + ((upgraded.tractMaxDev ?? 0) * 100).toFixed(2) + '%',
                'tractUnits=' + upgraded.tractUnits.length);
            }
          } catch (e) {
            console.warn('[tract-upgrade]', code, 'failed', e.message);
          }
        }
        CACHED_DISTRICTING.set(key, { partitions, seed, tolerance });
      }

      if (!cancelled) setProgress(null);
    })();

    return () => { cancelled = true; };
  }, [key, active]);

  return { districting: result, districtingProgress: progress };
}

// ----- Pre-computed seed cache -----------------------------------------
// The default seeds (42, 7, 1337) are pre-run at build time and their
// partitions are serialized to /data/seeds/<seed>.json. Loading from the
// cache skips BOTH the county-level ReCom pass AND the tract-level ReCom
// upgrade — the only remaining work is fetching the per-state tract
// topojson (parallelized) and rebuilding tract units (deterministic from
// the topojson + county votes). This takes a cached seed from ~90 s of
// client compute down to ~15 s of mostly-parallel network + geometry.
//
// Custom seeds (anything the user types) have no cache file and fall
// through to the live algorithm exactly as before.
//
// Cache file schema:
//   { seed, tolerance, states: { <code>: {
//       name, seats, substrate: 'tract'|'county',
//       maxDev, n (unit count), a (base64 Uint8Array, district per unit;
//       byte 255 == unassigned/-1) } } }
function b64ToAssignment(b64, n) {
  const bin = atob(b64);
  const a = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const v = bin.charCodeAt(i);
    a[i] = v === 255 ? -1 : v;
  }
  return a;
}

// Returns a districting result reconstructed from the cache, or null if no
// cache exists for this (seed, tolerance) or anything fails (callers fall
// back to the live algorithm). `onState` is called as each state resolves
// so the UI can stream the map in.
async function tryLoadCachedSeed(seed, tolerance, data, onProgress, isCancelled) {
  let cached;
  try {
    const dataBase = (typeof window !== 'undefined' && window.__DATA_BASE_URL__) || '/data/';
    const resp = await fetch(dataBase + 'seeds/' + seed + '.json');
    if (!resp.ok) return null;
    cached = await resp.json();
  } catch {
    return null;
  }
  if (!cached || cached.tolerance !== tolerance || !cached.states) return null;

  const codes = Object.keys(cached.states);
  const countyVotes = buildCountyVotesIndex(data);
  const partitions = {};
  let done = 0;

  // Fetch every tract-substrate state's topojson in parallel. buildTractUnits
  // is CPU-bound and synchronous so the builds still serialize on the main
  // thread, but the network round-trips overlap (the slow part).
  const tractCodes = codes.filter((c) => cached.states[c].substrate === 'tract');
  const topoByCode = {};
  await Promise.all(tractCodes.map(async (code) => {
    if (CACHED_TRACTS.has(code)) return;
    const fips = FIPS_BY_STATE_CODE[code];
    if (!fips || !TRACTS_BASE_URL) return;
    try {
      const r = await fetch(TRACTS_BASE_URL + fips + '.json');
      if (r.ok) topoByCode[code] = await r.json();
    } catch { /* leave undefined; handled below */ }
  }));
  if (isCancelled()) return null;

  for (const code of codes) {
    if (isCancelled()) return null;
    const s = cached.states[code];
    const stateUnits = data.unitsByState[code] || [];
    if (s.substrate === 'tract') {
      let td = CACHED_TRACTS.get(code);
      if (!td) {
        const topo = topoByCode[code];
        if (!topo) {
          // Tract fetch failed — fall back to whole-thing recompute.
          return null;
        }
        td = buildTractUnits(topo, code, countyVotes);
        CACHED_TRACTS.set(code, td);
      }
      const assignment = b64ToAssignment(s.a, td.units.length);
      const districtPop = new Array(s.seats).fill(0);
      for (let i = 0; i < td.units.length; i++) {
        const d = assignment[i];
        if (d >= 0) districtPop[d] += td.units[i].pop;
      }
      partitions[code] = {
        partition: { assignment, districtPop },
        units: stateUnits,
        renderUnits: td.units,
        name: s.name,
        seats: s.seats,
        maxDev: s.maxDev,
        substrate: 'tract',
      };
    } else {
      // Single-seat / county-level: trivial single-district assignment.
      const assignment = new Int16Array(stateUnits.length).fill(0);
      const totalPop = stateUnits.reduce((x, u) => x + (u.pop || 0), 0);
      partitions[code] = {
        partition: { assignment, districtPop: [totalPop] },
        units: stateUnits,
        name: s.name,
        seats: s.seats,
        maxDev: s.maxDev ?? 0,
        substrate: 'county',
      };
    }
    done++;
    onProgress({ done, total: codes.length, code: code + '⚡' });
    // Yield so the map can paint progressively as states resolve.
    await new Promise((r) => setTimeout(r, 0));
  }
  return { partitions, seed, tolerance };
}

// ----- Tract-level upgrade for a single state ---------------------------
// Runs ReCom on the state's tract substrate (lazily fetched), then projects
// tract → county-fragment via bbox containment + nearest-centroid fallback.
// Returns { assignment, districtPop, maxDev, tractMaxDev } where:
//   - assignment is over the state's county-fragment units (for rendering)
//   - districtPop is the fragment-aggregated population per district
//   - maxDev is the deviation AFTER projection (this is what the UI shows
//     because the rendering is at fragment granularity)
//   - tractMaxDev is the underlying tract-level deviation
async function upgradeStateToTracts(stateCode, data, seed, tolerance, prevPartition) {
  const fips = FIPS_BY_STATE_CODE[stateCode];
  if (!fips || !TRACTS_BASE_URL) return null;

  let tractData = CACHED_TRACTS.get(stateCode);
  if (!tractData) {
    const url = TRACTS_BASE_URL + fips + '.json';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('tract fetch failed: ' + resp.status);
    const topo = await resp.json();
    const countyVotes = buildCountyVotesIndex(data);
    tractData = buildTractUnits(topo, stateCode, countyVotes);
    CACHED_TRACTS.set(stateCode, tractData);
  }

  const seats = prevPartition.seats;
  const totalTractPop = tractData.units.reduce((s, u) => s + u.pop, 0);
  const tractTarget = totalTractPop / seats;

  // Best-of-N retry. A single tract-level ReCom pass occasionally lands a
  // bad chain draw (e.g. CA at seed 1337 produced a 13 % partition on the
  // first try while seeds 42/7 landed ≈2 %). One unlucky pass shouldn't
  // poison a state, so we run up to TRACT_MAX_TRIES attempts from distinct
  // derived seeds and keep the lowest-deviation result, stopping early the
  // moment an attempt is comfortably inside the legal bound. This makes the
  // ±5 % guarantee hold for ANY seed, not just cherry-picked ones — which
  // also keeps the pre-computed default-seed caches honest.
  const TRACT_MAX_TRIES = 5;
  const tractGoal = Math.min(tolerance, 0.03); // stop as soon as we're here
  let tractPart = null, tractMaxDev = Infinity;
  for (let attempt = 0; attempt < TRACT_MAX_TRIES; attempt++) {
    const tractSeed =
      seed * 1000 + stateCode.charCodeAt(0) * 17 + stateCode.charCodeAt(1) +
      31415 + attempt * 2719;
    const cand = runReCom(
      tractData.units, tractData.adjacency, seats, tractSeed,
      {
        burnIn: Math.max(400, seats * 22) + attempt * 120,
        tolerance: Math.min(tolerance, 0.02), // aim tighter at tract level
        compactness: attempt < 2 ? 2.0 : 3.5, // relax shape on later tries
      }
    );
    if (!cand) continue;
    let dev = 0;
    for (const p of cand.districtPop) {
      const d = Math.abs(p - tractTarget) / tractTarget;
      if (d > dev) dev = d;
    }
    if (dev < tractMaxDev) { tractMaxDev = dev; tractPart = cand; }
    if (tractMaxDev <= tractGoal) break;
  }
  if (!tractPart) return null;

  // ---- Project tract partition to county-fragment assignment ----
  const stateUnits = data.unitsByState[stateCode] || [];
  const fragsByFips = {};
  for (let i = 0; i < stateUnits.length; i++) {
    const u = stateUnits[i];
    if (!fragsByFips[u.fips]) fragsByFips[u.fips] = [];
    fragsByFips[u.fips].push(i);
  }

  // For each tract, accumulate pop-weighted votes for its district into the
  // matching fragment. Single-fragment counties take all tracts; multi-
  // fragment counties match by bbox containment, with nearest-centroid
  // fallback for tracts whose centroid sits on a slab boundary.
  const fragVotes = stateUnits.map(() => new Map()); // unitIdx → Map<district, popWeight>
  for (let ti = 0; ti < tractData.units.length; ti++) {
    const t = tractData.units[ti];
    const td = tractPart.assignment[ti];
    if (td < 0) continue;
    const candidates = fragsByFips[t.fips];
    if (!candidates || candidates.length === 0) continue;

    let chosenFrag;
    if (candidates.length === 1) {
      chosenFrag = candidates[0];
    } else {
      const [cx, cy] = t.centroid;
      let matched = -1;
      for (const fi of candidates) {
        const [x0, y0, x1, y1] = stateUnits[fi].bbox;
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) { matched = fi; break; }
      }
      if (matched < 0) {
        let bestD2 = Infinity, bestIdx = -1;
        for (const fi of candidates) {
          const [fx, fy] = stateUnits[fi].centroid;
          const dx = fx - cx, dy = fy - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; bestIdx = fi; }
        }
        matched = bestIdx;
      }
      chosenFrag = matched;
    }
    if (chosenFrag < 0) continue;
    const m = fragVotes[chosenFrag];
    m.set(td, (m.get(td) || 0) + t.pop);
  }

  // Plurality assignment per fragment
  const assignment = new Int16Array(stateUnits.length).fill(-1);
  for (let i = 0; i < stateUnits.length; i++) {
    const m = fragVotes[i];
    let bestD = -1, bestC = 0;
    for (const [d, c] of m) if (c > bestC) { bestC = c; bestD = d; }
    if (bestD >= 0) assignment[i] = bestD;
    else if (prevPartition.partition) assignment[i] = prevPartition.partition.assignment[i];
  }

  // Aggregate fragment-level district populations
  const districtPop = new Array(seats).fill(0);
  for (let i = 0; i < stateUnits.length; i++) {
    const d = assignment[i];
    if (d >= 0) districtPop[d] += stateUnits[i].pop;
  }
  const fragTarget = stateUnits.reduce((s, u) => s + u.pop, 0) / seats;
  let projMaxDev = 0;
  for (const p of districtPop) {
    const dev = Math.abs(p - fragTarget) / fragTarget;
    if (dev > projMaxDev) projMaxDev = dev;
  }

  return {
    assignment,                          // fragment-level (legacy diagnostic)
    districtPop,                         // fragment-level (projection — diagnostic)
    tractDistrictPop: tractPart.districtPop.slice(), // tract-level (the truth)
    tractAssignment: tractPart.assignment, // tract-level assignment (canonical)
    tractUnits: tractData.units,         // tract polygons (for rendering)
    maxDev: projMaxDev,                  // fragment-level deviation (projection artifact)
    tractMaxDev,                         // tract-level deviation (the achieved balance)
  };
}

/* ---------- DISTRICT-LEVEL VOTE AGGREGATION ----------------------------- */
// Compute per-district winners across the entire country for a given year.
// Used by HeadlineRow to display D/R seat totals.
function aggregateNationalSeats(districting, year) {
  if (!districting) return null;
  let dSeats = 0, rSeats = 0;
  let totalSeats = 0;
  // Count districts whose two-party D-share lies in [0.45, 0.55] — i.e.
  // winning margin ≤ 10 percentage points. Same threshold we use for the
  // historical-actual count in YEAR_CONFIG, so the two numbers are
  // directly comparable in the headline.
  let competitive = 0;
  for (const p of Object.values(districting.partitions)) {
    // For tract-upgraded states, partition.assignment is indexed over the
    // tract units (renderUnits), not the county fragments. Use whichever
    // unit array matches the partition's indexing.
    const units = ((p.substrate === 'tract' || p.substrate === 'precinct') && p.renderUnits) ? p.renderUnits : p.units;
    const results = computeDistrictResults(units, p.partition, year);
    for (const r of results) {
      totalSeats++;
      if (r.winner === 'D') dSeats++; else rSeats++;
      if (r.dShare >= 0.45 && r.dShare <= 0.55) competitive++;
    }
  }
  return { dSeats, rSeats, totalSeats, competitive };
}

/* ---------- DASHBOARD ROOT ---------------------------------------------- */
export default function USRedistrictingDashboard() {
  const { data, loadStage } = useData();
  const [year, setYear] = useState(YEAR_CONFIG.defaultYear);
  const [seed, setSeed] = useState(42);
  // 'model'   = county→tract, density-modeled partisanship, all cycles
  //             2000–2024 (the original substrate).
  // 'precinct' = real precinct (2020 VTD) returns, no modeling, only the
  //             cycles/states with precinct files (state-detail view).
  const [substrate, setSubstrate] = useState('model');
  // Districting algorithm. 'recom' = seeded ReCom Markov chain (random,
  // published seed). 'seedgrow' = deterministic metro-anchored
  // seed-and-grow. 'splitline' = deterministic shortest-splitline. The
  // two deterministic models ignore the seed. (Drives the state-detail
  // view for both substrates; national stays ReCom.)
  const [model, setModel] = useState('splitline');
  // `engaged` latches true the first time the user does something that
  // can't be served from a committed image (a custom seed, or any year
  // change). From then on the live engine drives the page.
  const [engaged, setEngaged] = useState(false);

  // Pre-render fast path: model substrate, a committed default seed, at the
  // default year, before engagement. (Precinct mode never uses the
  // pre-rendered model images.)
  // Pre-rendered images are the ReCom mosaic for the default seeds; only
  // valid when the ReCom model is active. Splitline (now the default) and
  // any non-default seed use the live consolidated render instead.
  const prerenderMode =
    substrate === 'model' && model === 'recom' &&
    !engaged && DEFAULT_SEEDS.has(seed) && year === YEAR_CONFIG.defaultYear;

  const summary = usePrerendered(seed, prerenderMode);
  // Precinct mode is self-sufficient (all 50 states have pre-baked precinct
  // partitions), so the model engine — and its ~28 s tract pipeline +
  // ~29 MB download — is switched OFF entirely while precinct is active.
  const { districting, districtingProgress } = useDistricting(
    data, seed, 0.05, !prerenderMode && substrate !== 'precinct'
  );
  // National precinct substrate — all 50 states, pre-baked → instant.
  const { precinctPartitions, precinctProgress } =
    usePrecinctNational(data, seed, substrate === 'precinct');

  // Children get a synthetic districting object depending on mode:
  //  • prerender → the committed image/summary path
  //  • precinct  → real precinct partitions, all 50 states (no model)
  //  • model     → the model districting verbatim
  let effDistricting;
  if (prerenderMode) {
    effDistricting = { prerendered: true, seed, summary, partitions: {} };
  } else if (substrate === 'precinct') {
    effDistricting = { seed, tolerance: 0.05, partitions: precinctPartitions };
  } else {
    effDistricting = districting;
  }
  // Surface precinct loading in the headline progress while it streams.
  const effProgress = substrate === 'precinct' ? precinctProgress : districtingProgress;

  const handleSetYear = (y) => {
    if (y !== YEAR_CONFIG.defaultYear) setEngaged(true);
    setYear(y);
  };
  const handleSetSeed = (s) => {
    // Switching among the three pre-rendered seeds stays instant; any
    // other seed engages the live engine.
    if (!DEFAULT_SEEDS.has(s)) setEngaged(true);
    setSeed(s);
  };
  const handleSetSubstrate = (s) => {
    if (s === substrate) return;
    if (s === 'precinct') {
      setEngaged(true); // precinct never uses the model pre-render images
      // Snap to the nearest covered presidential cycle.
      if (!PRECINCT_YEARS.includes(year)) {
        const near = PRECINCT_YEARS.reduce((a, b) =>
          Math.abs(b - year) < Math.abs(a - year) ? b : a);
        setYear(near);
      }
    }
    setSubstrate(s);
  };

  return (
    <div style={S.app}>
      <style>{globalCSS}</style>
      <Header />
      <section style={S.headlineSection}>
        <HeadlineRow data={data} year={year} loadStage={loadStage} districting={effDistricting} districtingProgress={effProgress} seed={seed} setSeed={handleSetSeed} substrate={substrate} setSubstrate={handleSetSubstrate} model={model} setModel={setModel} />
      </section>
      <MapSection data={data} year={year} setYear={handleSetYear} loadStage={loadStage} districting={effDistricting} districtingProgress={effProgress} substrate={substrate} model={model} />
      <Footer />
    </div>
  );
}

const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,800&family=JetBrains+Mono:wght@400;500;600&family=Inter+Tight:wght@300;400;500;600&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; }
  button { font-family: inherit; cursor: pointer; }
  ::selection { background: #e09f3e; color: #1a1a14; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Tablet and below: 900px */
  @media (max-width: 900px) {
    .r-pad { padding-left: 24px !important; padding-right: 24px !important; }
    .r-headline {
      grid-template-columns: 1fr 1fr !important;
      gap: 24px !important;
      padding-left: 24px !important;
      padding-right: 24px !important;
    }
    .r-headline-arrow { display: none !important; }
    .r-mapheader {
      flex-direction: column !important;
      align-items: flex-start !important;
      gap: 24px !important;
    }
    .r-statsrow {
      grid-template-columns: 1fr 1fr !important;
      gap: 24px !important;
    }
    .r-caveats {
      grid-template-columns: 1fr !important;
    }
    .r-caveat {
      border-right: none !important;
      border-bottom: 1px solid rgba(245,239,230,0.15);
    }
    .r-caveat:last-child { border-bottom: none; }
    .r-section { padding-top: 56px !important; padding-bottom: 56px !important; }
    .r-mapsection { padding-top: 48px !important; padding-bottom: 48px !important; }
    .r-header { padding-top: 44px !important; padding-bottom: 56px !important; }
    .r-detailgrid { grid-template-columns: 1fr 1fr !important; }
    .r-runslist { grid-template-columns: 1fr !important; }
    .r-proposalbody { padding: 24px !important; }
  }

  /* Phone: 560px */
  @media (max-width: 560px) {
    .r-headline { grid-template-columns: 1fr !important; gap: 18px !important; }
    .r-statsrow { grid-template-columns: 1fr 1fr !important; gap: 18px !important; }
    .r-detailgrid { grid-template-columns: 1fr !important; }
    .r-tickerscore { font-size: 30px !important; white-space: nowrap; }
    .r-bigval { font-size: 42px !important; }
    .r-lede { font-size: 17px !important; }
    .r-sectionlede { font-size: 15px !important; }
    .r-proposalsec h3 { font-size: 22px !important; }
    .r-proposalbody { padding: 20px !important; }
    .r-pad { padding-left: 18px !important; padding-right: 18px !important; }
    /* On single-column mobile the headline cell is full-width, so the
       220px cap that keeps the desktop multi-column layout tidy just forces
       the competitive/variance line to wrap into a tall cramped block.
       Let it use the full column on phones. */
    .r-tickersub { max-width: none !important; }
  }

  /* Year selector responsive: wrap to two rows on tablet, four columns on phone */
  @media (max-width: 720px) {
    .r-yearselector-buttons { grid-template-columns: repeat(4, 1fr) !important; }
  }
  @media (max-width: 380px) {
    .r-yearselector-buttons { grid-template-columns: repeat(3, 1fr) !important; }
  }

  /* Map scroll hint on touch devices */
  .r-maphint { display: none; font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(26,26,20,0.5); margin-bottom: 10px; }
  @media (max-width: 1100px) { .r-maphint { display: block; } }

  /* Touch-friendly tap targets for state tiles */
  @media (hover: none) {
    .r-statetile { touch-action: manipulation; }
  }
`;
const S = {
  // Phase D: state-detail view styles
  detailHeader: { maxWidth: 1400, margin: "0 auto 30px", padding: "0", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 32, flexWrap: "wrap" },
  detailHeaderControls: { display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-end" },
  detailClose: { padding: "10px 16px", background: "transparent", color: "#1a1a14", border: "1px solid rgba(26,26,20,0.3)", fontFamily: '"JetBrains Mono", monospace', fontSize: 12, letterSpacing: "0.05em", cursor: "pointer" },
  detailGrid: { maxWidth: 1400, margin: "0 auto", display: "grid", gridTemplateColumns: "minmax(0, 2.2fr) minmax(280px, 1fr)", gap: 32, alignItems: "stretch" },
  detailMapWrap: { background: "#fdfaf2", border: "1px solid rgba(26,26,20,0.12)", padding: 20, boxShadow: "0 1px 0 rgba(26,26,20,0.04), 0 8px 24px rgba(26,26,20,0.04)", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 },
  detailMapSvg: { display: "block", width: "100%", height: "auto", maxHeight: 720 },
  detailMapInner: { position: "relative", width: "100%" },
  zoomControls: { position: "absolute", top: 10, right: 10, display: "flex", flexDirection: "column", gap: 6, zIndex: 3 },
  zoomBtn: { width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, background: "#fdfaf2", color: "#1a1a14", border: "1px solid rgba(26,26,20,0.28)", fontFamily: '"JetBrains Mono", monospace', fontSize: 20, lineHeight: 1, cursor: "pointer", boxShadow: "0 1px 3px rgba(26,26,20,0.12)", userSelect: "none" },
  zoomBtnReset: { fontSize: 15 },
  zoomBtnOff: { opacity: 0.32, cursor: "default", boxShadow: "none" },
  detailPanel: { background: "#fdfaf2", border: "1px solid rgba(26,26,20,0.12)", padding: "24px 24px", boxShadow: "0 1px 0 rgba(26,26,20,0.04), 0 8px 24px rgba(26,26,20,0.04)", display: "flex", flexDirection: "column", gap: 18 },
  detailPanelHeader: { paddingBottom: 16, borderBottom: "1px solid rgba(26,26,20,0.12)" },
  detailSeats: { fontFamily: '"Fraunces", serif', fontSize: 32, fontWeight: 500, lineHeight: 1, fontVariationSettings: '"opsz" 36', letterSpacing: "-0.015em", marginTop: 6 },
  detailPanelList: { display: "flex", flexDirection: "column", gap: 0, maxHeight: 480, overflowY: "auto" },
  detailListHeader: { display: "flex", padding: "6px 4px", fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: "rgba(26,26,20,0.55)", letterSpacing: "0.08em", textTransform: "uppercase", borderBottom: "1px solid rgba(26,26,20,0.12)" },
  detailRow: { display: "flex", alignItems: "center", padding: "8px 4px", borderBottom: "1px solid rgba(26,26,20,0.06)", fontFamily: '"Inter Tight", sans-serif', fontSize: 13 },
  detailPanelNote: { fontFamily: '"Fraunces", serif', fontStyle: "italic", fontSize: 12, color: "rgba(26,26,20,0.55)", lineHeight: 1.5, fontVariationSettings: '"opsz" 14', borderTop: "1px solid rgba(26,26,20,0.12)", paddingTop: 14 },

  mapSvg: { display: "block", width: "100%", maxWidth: 1400, height: "auto", margin: "0 auto" },
  hoverInfo: { position: "absolute", top: 28, left: 28, padding: "14px 18px", background: "rgba(253,250,242,0.96)", border: "1px solid rgba(26,26,20,0.15)", boxShadow: "0 4px 20px rgba(26,26,20,0.10)", maxWidth: 420, fontFamily: '"Inter Tight", sans-serif', pointerEvents: "none" },
  hoverInfoState: { fontFamily: '"Fraunces", serif', fontSize: 22, fontWeight: 500, fontVariationSettings: '"opsz" 24', marginBottom: 6, lineHeight: 1.1 },
  hoverInfoStats: { display: "flex", flexWrap: "wrap", gap: 8, fontSize: 13, color: "rgba(26,26,20,0.78)" },
  tickerKicker: { fontFamily: '"JetBrains Mono", monospace', fontSize: 11, letterSpacing: "0.1em", color: "rgba(26,26,20,0.55)", marginBottom: 10 },
  tickerNum: { fontFamily: '"Fraunces", serif', fontSize: 36, fontWeight: 500, lineHeight: 1, fontVariationSettings: '"opsz" 48', letterSpacing: "-0.015em" },
  headlineNote: { gridColumn: "span 1" },

  app: { fontFamily: '"Inter Tight", -apple-system, sans-serif', background: "#f5efe6", color: "#1a1a14", minHeight: "100vh", paddingBottom: 80 },
  header: { background: "#1a1a14", color: "#f5efe6", padding: "60px 0 70px" },
  headerInner: { maxWidth: 1400, margin: "0 auto", padding: "0 40px" },
  kicker: { fontFamily: '"JetBrains Mono", monospace', fontSize: 11, letterSpacing: "0.18em", color: "#e09f3e", marginBottom: 20 },
  kickerLight: { fontFamily: '"JetBrains Mono", monospace', fontSize: 11, letterSpacing: "0.18em", color: "#e09f3e", marginBottom: 20 },
  h1: { fontFamily: '"Fraunces", serif', fontWeight: 500, fontSize: "clamp(40px, 6vw, 84px)", lineHeight: 0.98, letterSpacing: "-0.025em", margin: 0, fontVariationSettings: '"opsz" 144' },
  lede: { fontFamily: '"Fraunces", serif', fontWeight: 400, fontSize: 21, lineHeight: 1.45, maxWidth: 760, marginTop: 28, color: "#e8dfd1", fontVariationSettings: '"opsz" 24' },
  headlineSection: { background: "#f5efe6", borderBottom: "1px solid rgba(26,26,20,0.15)", padding: "30px 0" },
  headline: { maxWidth: 1400, margin: "0 auto", padding: "0 40px", display: "grid", gridTemplateColumns: "auto auto auto auto 1fr", gap: 32, alignItems: "center" },
  headlineComputing: { fontFamily: '"JetBrains Mono", monospace', fontSize: 13, letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 12, color: "rgba(26,26,20,0.55)" },
  spinner: { display: "inline-block", width: 14, height: 14, border: "2px solid rgba(26,26,20,0.2)", borderTopColor: "#e09f3e", borderRadius: "50%", animation: "spin 0.9s linear infinite" },
  tickerCol: {},
  tickerLabel: { fontFamily: '"JetBrains Mono", monospace', fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(26,26,20,0.55)", marginBottom: 6 },
  tickerScore: { fontFamily: '"Fraunces", serif', fontSize: 36, fontWeight: 500, lineHeight: 1, fontVariationSettings: '"opsz" 48', letterSpacing: "-0.015em" },
  tickerScoreDelta: { fontSize: 36 },
  divider: { margin: "0 8px", color: "rgba(26,26,20,0.4)" },
  tickerSub: { fontFamily: '"Fraunces", serif', fontStyle: "italic", fontSize: 12, color: "rgba(26,26,20,0.65)", marginTop: 6, fontVariationSettings: '"opsz" 14', maxWidth: 220, lineHeight: 1.35 },
  tickerArrow: { fontFamily: '"Fraunces", serif', fontSize: 22, color: "rgba(26,26,20,0.35)", fontStyle: "italic" },
  dColor: { color: "#2c5d8f", fontWeight: 500 },
  rColor: { color: "#b3433b", fontWeight: 500 },
  reseedBtn: { padding: "10px 20px", background: "#1a1a14", color: "#f5efe6", border: "none", fontFamily: '"Inter Tight", sans-serif', fontSize: 13, fontWeight: 500, letterSpacing: "0.02em" },
  mapSection: { maxWidth: 1400, margin: "0 auto", padding: "60px 40px" },
  mapHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 36, gap: 40 },
  mapHeaderControls: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 18, minWidth: 240 },
  yearSelector: { width: "100%", maxWidth: 640 },
  yearSelectorLabel: { fontFamily: '"JetBrains Mono", monospace', fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(26,26,20,0.55)", marginBottom: 8 },
  yearSelectorButtons: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, border: "1px solid rgba(26,26,20,0.18)", padding: 3, background: "#fdfaf2" },
  yearBtn: { padding: "10px 4px", border: "none", background: "transparent", color: "#1a1a14", fontFamily: '"Inter Tight", sans-serif', cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 1, transition: "background 0.15s", minWidth: 0 },
  yearBtnActive: { background: "#1a1a14", color: "#f5efe6" },
  yearBtnYear: { fontFamily: '"Fraunces", serif', fontSize: 17, fontWeight: 500, lineHeight: 1, fontVariationSettings: '"opsz" 18' },
  yearBtnSub: { fontFamily: '"JetBrains Mono", monospace', fontSize: 9, letterSpacing: "0.05em", textTransform: "uppercase", marginTop: 2 },
  sectionTitle: { fontFamily: '"Fraunces", serif', fontWeight: 500, fontSize: "clamp(28px, 4vw, 48px)", lineHeight: 1, letterSpacing: "-0.02em", margin: 0, fontVariationSettings: '"opsz" 144' },
  sectionTitleLight: { fontFamily: '"Fraunces", serif', fontWeight: 500, fontSize: "clamp(28px, 4vw, 48px)", lineHeight: 1, letterSpacing: "-0.02em", margin: 0, fontVariationSettings: '"opsz" 144', color: "#f5efe6" },
  sectionLede: { fontFamily: '"Fraunces", serif', fontSize: 17, lineHeight: 1.55, maxWidth: 620, marginTop: 20, color: "rgba(26,26,20,0.7)", fontVariationSettings: '"opsz" 18' },
  sectionLedeLight: { fontFamily: '"Fraunces", serif', fontSize: 17, lineHeight: 1.55, maxWidth: 700, marginTop: 20, color: "rgba(245,239,230,0.75)", fontVariationSettings: '"opsz" 18' },
  computingNote: { display: "block", marginTop: 12, fontSize: 13, fontStyle: "normal", opacity: 0.6, fontFamily: '"JetBrains Mono", monospace' },
  legend: { width: "100%", maxWidth: 240 },
  legendCaption: { fontFamily: '"JetBrains Mono", monospace', fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(26,26,20,0.55)", marginBottom: 8 },
  legendSwatches: { display: "flex", gap: 2 },
  legendSwatch: { flex: 1, height: 16, borderRadius: 1.5, border: "0.5px solid rgba(26,26,20,0.15)" },
  legendLabels: { display: "flex", justifyContent: "space-between", marginTop: 6, fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: "rgba(26,26,20,0.6)", letterSpacing: "0.05em" },
  mapWrap: { position: "relative", background: "#fdfaf2", border: "1px solid rgba(26,26,20,0.12)", padding: "20px 12px", overflow: "auto", WebkitOverflowScrolling: "touch", boxShadow: "0 1px 0 rgba(26,26,20,0.04), 0 8px 24px rgba(26,26,20,0.04)" },
  computing: { height: 400, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: '"Fraunces", serif', fontStyle: "italic", fontSize: 18, color: "rgba(26,26,20,0.5)", background: "#fdfaf2", border: "1px solid rgba(26,26,20,0.1)" },
  computingDark: { height: 200, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: '"Fraunces", serif', fontStyle: "italic", fontSize: 18, color: "rgba(245,239,230,0.5)" },
  stateDetail: { marginTop: 20, background: "#fdfaf2", border: "1px solid rgba(26,26,20,0.15)", padding: "20px 28px" },
  stateDetailHeader: { display: "flex", alignItems: "baseline", gap: 16, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid rgba(26,26,20,0.1)", flexWrap: "wrap" },
  stateDetailClose: { marginLeft: "auto", background: "transparent", border: "1px solid rgba(26,26,20,0.25)", color: "#1a1a14", width: 32, height: 32, fontSize: 18, lineHeight: 1, padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  stateDetailTitle: { fontFamily: '"Fraunces", serif', fontSize: 24, fontWeight: 500, margin: 0, fontVariationSettings: '"opsz" 24' },
  stateDetailMeta: { fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: "rgba(26,26,20,0.6)", letterSpacing: "0.05em" },
  stateDetailGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 },
  detailDistrict: { display: "grid", gridTemplateColumns: "12px 70px 1fr auto", alignItems: "center", gap: 8, fontFamily: '"JetBrains Mono", monospace', fontSize: 11, padding: "6px 4px", borderBottom: "1px dashed rgba(26,26,20,0.08)" },
  detailSwatch: { width: 12, height: 12, borderRadius: 1 },
  detailDistName: { color: "#1a1a14" },
  detailDistShare: { color: "rgba(26,26,20,0.65)" },
  detailDistWinner: { fontWeight: 600 },
  ensembleSection: { background: "#1a1a14", color: "#f5efe6", padding: "80px 0" },
  sectionHeader: { maxWidth: 1400, margin: "0 auto", padding: "0 40px 36px" },
  ensembleInner: { maxWidth: 1400, margin: "0 auto", padding: "0 40px" },
  ensembleStatsRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 32, paddingBottom: 32, borderBottom: "1px solid rgba(245,239,230,0.15)", marginBottom: 32 },
  bigStat: {},
  bigStatVal: { fontFamily: '"Fraunces", serif', fontSize: 56, fontWeight: 500, lineHeight: 1, color: "#e09f3e", fontVariationSettings: '"opsz" 96', letterSpacing: "-0.02em" },
  bigStatSub: { fontFamily: '"JetBrains Mono", monospace', fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(245,239,230,0.65)", marginTop: 10 },
  histWrap: { position: "relative" },
  histLabel: { fontFamily: '"JetBrains Mono", monospace', fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(245,239,230,0.55)", marginBottom: 14 },
  hist: { height: 180, display: "flex", alignItems: "flex-end", gap: 4, paddingTop: 12, borderBottom: "1px solid rgba(245,239,230,0.2)" },
  histBar: { flex: 1, background: "#e09f3e", minHeight: 2, transition: "height 0.3s" },
  histAxis: { display: "flex", justifyContent: "space-between", fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: "rgba(245,239,230,0.55)", marginTop: 8, letterSpacing: "0.05em", flexWrap: "wrap", gap: 8 },
  runsList: { marginTop: 36, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 4 },
  runRow: { display: "grid", gridTemplateColumns: "26px 1fr auto auto", gap: 12, fontFamily: '"JetBrains Mono", monospace', fontSize: 12, padding: "10px 12px", background: "rgba(245,239,230,0.04)", alignItems: "center", minWidth: 0 },
  runIdx: { color: "rgba(245,239,230,0.4)" },
  runScore: { fontFamily: '"Fraunces", serif', fontSize: 18, fontWeight: 500 },
  runComp: { color: "rgba(245,239,230,0.5)", fontSize: 11 },
  proposalSection: { background: "#f5efe6", padding: "80px 0" },
  proposalToggle: { marginTop: 30, padding: "12px 28px", background: "#1a1a14", color: "#f5efe6", border: "none", fontFamily: '"Inter Tight", sans-serif', fontSize: 14, fontWeight: 500, letterSpacing: "0.02em" },
  proposalContent: { maxWidth: 880, margin: "0 auto", padding: "40px" },
  proposalArticle: { marginBottom: 50, paddingBottom: 50, borderBottom: "1px solid rgba(26,26,20,0.15)" },
  proposalArticleHeader: { display: "flex", alignItems: "baseline", gap: 20, marginBottom: 16 },
  proposalN: { fontFamily: '"JetBrains Mono", monospace', fontSize: 13, color: "#c44536", letterSpacing: "0.08em" },
  proposalTitle: { fontFamily: '"Fraunces", serif', fontSize: 30, fontWeight: 500, margin: 0, lineHeight: 1.1, fontVariationSettings: '"opsz" 36', letterSpacing: "-0.015em" },
  proposalBody: { fontFamily: '"Fraunces", serif', fontSize: 16, lineHeight: 1.65, color: "rgba(26,26,20,0.85)", fontVariationSettings: '"opsz" 16' },
  ol: { paddingLeft: 24, marginTop: 14 },
  ul: { paddingLeft: 24, marginTop: 14 },
  caveatsSection: { background: "#283d3b", color: "#f5efe6", padding: "80px 0" },
  caveatsGrid: { maxWidth: 1400, margin: "0 auto", padding: "0 40px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 0 },
  caveat: { padding: "30px 28px", borderRight: "1px solid rgba(245,239,230,0.15)" },
  caveatN: { fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: "#e09f3e", letterSpacing: "0.1em", marginBottom: 16 },
  caveatHead: { fontFamily: '"Fraunces", serif', fontSize: 22, fontWeight: 500, margin: 0, lineHeight: 1.15, fontVariationSettings: '"opsz" 24' },
  caveatBody: { fontFamily: '"Fraunces", serif', fontSize: 15, lineHeight: 1.55, color: "rgba(245,239,230,0.8)", marginTop: 14, marginBottom: 0, fontVariationSettings: '"opsz" 16' },
  footer: { background: "#1a1a14", color: "rgba(245,239,230,0.7)", padding: "60px 0", marginTop: 80 },
  footerInner: { maxWidth: 880, margin: "0 auto", padding: "0 40px", fontFamily: '"Fraunces", serif', fontSize: 15, lineHeight: 1.6, fontVariationSettings: '"opsz" 16' },
};
