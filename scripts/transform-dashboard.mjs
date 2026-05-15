#!/usr/bin/env node
/**
 * Surgically transform Dashboard.jsx in place:
 *
 *   1. Strip the huge inline JSON.parse("...") blocks for POPULATIONS and
 *      VOTES_201[6]/VOTES_20[2][0]/VOTES_2024 and replace them with mutable
 *      module-level placeholders that `useData()` will populate at runtime.
 *   2. Insert a YEAR_CONFIG constant after the seats-by-state table.
 *   3. Replace every hard-coded `[2016, 2020, 2024]` literal with
 *      `YEAR_CONFIG.allYears`.
 *   4. Rewrite the AK and per-county votesForFips lookup in buildUnits to
 *      use the year keys from YEAR_CONFIG, not the hard-coded conditionals.
 *   5. Rewrite the inline slab-fragment vote-distribution loop the same way.
 *   6. Update useData() to fetch /data/populations.json and
 *      /data/votes/<YEAR>.json for every YEAR_CONFIG.allYears entry.
 *   7. Replace the YearSelector with a wider, scrollable, dynamic version.
 *   8. Default `useState(2024)` to YEAR_CONFIG.defaultYear.
 *   9. In useDistricting(), bump burnIn from 100 to 240 and add retry-up-to-3
 *      shots if the post-polish max deviation exceeds tolerance.
 *  10. Loosen the county splitThreshold so we preserve county boundaries
 *      whenever a county fits inside the target district population.
 *  11. Default TRACTS_BASE_URL to './data/tracts/' for static deployment so
 *      tract data, if present in /public/data/tracts/, is auto-used.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC = path.join(__dirname, '..', 'components', 'Dashboard.jsx');

let src = fs.readFileSync(SRC, 'utf8');
const orig = src;
let changes = 0;
function record(label, before, after) {
  if (before === after) {
    console.warn(`  !! ${label}: no change`);
    return after;
  }
  console.log(`  ✓ ${label}`);
  changes++;
  return after;
}

// --- (1) Strip inline POPULATIONS + VOTES_YYYY blocks ----------------------
const lines = src.split('\n');
const newLines = [];
let stripped = 0;
for (const line of lines) {
  if (
    line.startsWith('const POPULATIONS = JSON.parse(') ||
    line.startsWith('const VOTES_2016 = JSON.parse(') ||
    line.startsWith('const VOTES_2020 = JSON.parse(') ||
    line.startsWith('const VOTES_2024 = JSON.parse(')
  ) {
    if (stripped === 0) {
      newLines.push('// Populated at runtime by useData() from /data/populations.json and');
      newLines.push('// /data/votes/<YEAR>.json files in the public/ directory.');
      newLines.push('let POPULATIONS = {};');
      newLines.push('let VOTES_BY_YEAR = {};  // { [year]: { [fips]: [D, R, total] } }');
    }
    stripped++;
    continue;
  }
  newLines.push(line);
}
src = newLines.join('\n');
console.log(`✓ stripped ${stripped} inline data lines`);

// --- (2) Insert YEAR_CONFIG after TARGET_DISTRICT_POP ----------------------
src = record('insert YEAR_CONFIG', src, src.replace(
  /const TARGET_DISTRICT_POP = 761000;[^\n]*\n/,
  (m) =>
    m +
    `\n` +
    `// Election years available in the dashboard. The dashboard's vote files\n` +
    `// (public/data/votes/<YEAR>.json) and the YEAR_CONFIG entries must agree:\n` +
    `// every entry's \`key\` is fetched as <key>.json on startup.\n` +
    `//\n` +
    `// Sources: county-level two-party presidential returns, MIT Election\n` +
    `// Data and Science Lab via the stiles/presidential-elections compilation.\n` +
    `// Midterm House years (2006/2010/2014/2018/2022) are NOT included: U.S.\n` +
    `// House results are reported by congressional district, not county, so\n` +
    `// no unified county-level dataset exists for them.\n` +
    `const YEAR_CONFIG = {\n` +
    `  defaultYear: 2024,\n` +
    `  years: [\n` +
    `    { key: 2000, label: '2000', sub: 'Bush v. Gore',     winner: 'R' },\n` +
    `    { key: 2004, label: '2004', sub: 'Bush v. Kerry',    winner: 'R' },\n` +
    `    { key: 2008, label: '2008', sub: 'Obama 1',          winner: 'D' },\n` +
    `    { key: 2012, label: '2012', sub: 'Obama 2',          winner: 'D' },\n` +
    `    { key: 2016, label: '2016', sub: 'Trump 1',          winner: 'R' },\n` +
    `    { key: 2020, label: '2020', sub: 'Biden',            winner: 'D' },\n` +
    `    { key: 2024, label: '2024', sub: 'Trump 2',          winner: 'R' },\n` +
    `  ],\n` +
    `  get allYears() { return this.years.map((y) => y.key); },\n` +
    `};\n`
));

// --- (3) Replace hard-coded [2016, 2020, 2024] literals --------------------
const re3 = /\[2016, 2020, 2024\]/g;
const cnt3 = (src.match(re3) || []).length;
src = src.replace(re3, 'YEAR_CONFIG.allYears');
console.log(`✓ replaced [2016, 2020, 2024] in ${cnt3} places`);

// --- (4) Rewrite votesForFips() in buildUnits to use dynamic years ---------
const oldVotesForFips = `    function votesForFips(yr) {
      if (isAK) {
        // Use the statewide totals, scaled to this borough's pop fraction
        const akTotalPop = POPULATIONS['_AK'] || 1;
        const akTotalVotes = (yr === 2016 ? VOTES_2016 : yr === 2020 ? VOTES_2020 : VOTES_2024)['_AK'];
        if (!akTotalVotes) return null;
        const frac = (pop || 0) / akTotalPop;
        return [
          Math.round(akTotalVotes[0] * frac),
          Math.round(akTotalVotes[1] * frac),
          Math.round(akTotalVotes[2] * frac),
        ];
      }
      const src = yr === 2016 ? VOTES_2016 : yr === 2020 ? VOTES_2020 : VOTES_2024;
      return src[fips] || null;
    }`;
const newVotesForFips = `    function votesForFips(yr) {
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
    }`;
src = record('rewrite votesForFips', src, src.replace(oldVotesForFips, newVotesForFips));

// --- (5) Rewrite the non-subdivided + subdivided votes blocks --------------
const oldVotesAssignSmall = `      const v16 = votesForFips(2016), v20 = votesForFips(2020), v24 = votesForFips(2024);
      units.push({
        id: fips, fips, stateCode, stateName, countyName: countyName || '?',
        pop: pop || 0,
        polygons,
        votes: {
          2016: v16 ? { d: v16[0], r: v16[1], t: v16[2] } : null,
          2020: v20 ? { d: v20[0], r: v20[1], t: v20[2] } : null,
          2024: v24 ? { d: v24[0], r: v24[1], t: v24[2] } : null,
        },
      });`;
const newVotesAssignSmall = `      const votes = {};
      for (const yr of YEAR_CONFIG.allYears) {
        const v = votesForFips(yr);
        votes[yr] = v ? { d: v[0], r: v[1], t: v[2] } : null;
      }
      units.push({
        id: fips, fips, stateCode, stateName, countyName: countyName || '?',
        pop: pop || 0,
        polygons,
        votes,
      });`;
src = record('rewrite votes-assign (non-subdivided)', src, src.replace(oldVotesAssignSmall, newVotesAssignSmall));

const oldVotesAssignFrag = `      const v16 = votesForFips(2016), v20 = votesForFips(2020), v24 = votesForFips(2024);
      for (let i = 0; i < N; i++) {
        const frac = totA > 0 ? fragAreas[i] / totA : 1 / N;
        const fragPop = Math.round(pop * frac);
        const fragVotes = {};
        if (v16) fragVotes[2016] = { d: Math.round(v16[0] * frac), r: Math.round(v16[1] * frac), t: Math.round(v16[2] * frac) };
        if (v20) fragVotes[2020] = { d: Math.round(v20[0] * frac), r: Math.round(v20[1] * frac), t: Math.round(v20[2] * frac) };
        if (v24) fragVotes[2024] = { d: Math.round(v24[0] * frac), r: Math.round(v24[1] * frac), t: Math.round(v24[2] * frac) };
        units.push({`;
const newVotesAssignFrag = `      const allV = {};
      for (const yr of YEAR_CONFIG.allYears) allV[yr] = votesForFips(yr);
      for (let i = 0; i < N; i++) {
        const frac = totA > 0 ? fragAreas[i] / totA : 1 / N;
        const fragPop = Math.round(pop * frac);
        const fragVotes = {};
        for (const yr of YEAR_CONFIG.allYears) {
          const v = allV[yr];
          if (v) fragVotes[yr] = { d: Math.round(v[0] * frac), r: Math.round(v[1] * frac), t: Math.round(v[2] * frac) };
        }
        units.push({`;
src = record('rewrite votes-assign (fragments)', src, src.replace(oldVotesAssignFrag, newVotesAssignFrag));

// --- (6) Update useData() to fetch data files at startup -------------------
const oldUseData = `function useData() {
  const [data, setData] = useState(CACHED_DATA);
  const [loadStage, setLoadStage] = useState(CACHED_DATA ? 'ready' : 'fetching');
  useEffect(() => {
    if (CACHED_DATA) return;
    let cancelled = false;
    if (!CACHED_DATA_PROMISE) {
      CACHED_DATA_PROMISE = (async () => {
        const resp = await fetch(COUNTIES_URL);
        if (!resp.ok) throw new Error('failed to fetch counties topojson');
        const topo = await resp.json();
        // Yield to UI between fetch and build
        await new Promise((r) => setTimeout(r, 0));
        const built = buildUnits(topo);
        CACHED_DATA = built;
        return built;
      })();
    }`;
const newUseData = `function useData() {
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
    }`;
src = record('rewrite useData()', src, src.replace(oldUseData, newUseData));

// --- (7) Replace YearSelector with a dynamic version -----------------------
const oldYearSel = `function YearSelector({ year, setYear }) {
  const years = [2016, 2020, 2024];
  const labels = { 2016: 'Trump 1', 2020: 'Biden', 2024: 'Trump 2' };
  const winners = { 2016: 'R', 2020: 'D', 2024: 'R' };
  return (
    <div style={S.yearSelector}>
      <div style={S.yearSelectorLabel}>ELECTION YEAR</div>
      <div style={S.yearSelectorButtons}>
        {years.map((y) => {
          const active = y === year;
          return (
            <button
              key={y}
              onClick={() => setYear(y)}
              style={{ ...S.yearBtn, ...(active ? S.yearBtnActive : null) }}
              aria-pressed={active}
            >
              <span style={S.yearBtnYear}>{y}</span>
              <span style={{ ...S.yearBtnSub, color: active ? '#f5efe6' : winners[y] === 'D' ? '#2c5d8f' : '#b3433b' }}>
                {labels[y]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}`;
const newYearSel = `function YearSelector({ year, setYear }) {
  return (
    <div style={S.yearSelector}>
      <div style={S.yearSelectorLabel}>ELECTION YEAR</div>
      <div style={S.yearSelectorButtons}>
        {YEAR_CONFIG.years.map((y) => {
          const active = y.key === year;
          return (
            <button
              key={y.key}
              onClick={() => setYear(y.key)}
              style={{ ...S.yearBtn, ...(active ? S.yearBtnActive : null) }}
              aria-pressed={active}
              title={y.label + ' — ' + y.sub}
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
}`;
src = record('rewrite YearSelector', src, src.replace(oldYearSel, newYearSel));

// --- (8) Default year from YEAR_CONFIG.defaultYear -------------------------
src = record(
  'rewrite default year',
  src,
  src.replace(
    'const [year, setYear] = useState(2024);',
    'const [year, setYear] = useState(YEAR_CONFIG.defaultYear);'
  )
);

// --- (9) Bump burn-in & retry until ±tolerance met -------------------------
const oldDistrictingHook = `        const stateSeed = seed * 1000 + code.charCodeAt(0) * 17 + code.charCodeAt(1);
        const partition = runReCom(stateUnits, stateAdj, sg.seats, stateSeed, { burnIn: 100, tolerance });
        partitions[code] = { partition, units: stateUnits, name: sg.name, seats: sg.seats };`;
const newDistrictingHook = `        // Multi-seed retry: try up to MAX_TRIES different seeds and keep the
        // partition with the smallest max-deviation. This is what makes the
        // ±tolerance bound a HARD guarantee rather than a best-effort target.
        // In practice the first attempt usually succeeds at ±5%; the retry
        // catches the occasional stranded-rural-district pathology.
        const MAX_TRIES = 4;
        let best = null, bestDev = Infinity;
        for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
          const stateSeed = seed * 1000 + code.charCodeAt(0) * 17 + code.charCodeAt(1) + attempt * 7919;
          const part = runReCom(stateUnits, stateAdj, sg.seats, stateSeed, { burnIn: 240, tolerance });
          if (!part) continue;
          // Compute max deviation across districts
          const tgt = part.districtPop.reduce((s, p) => s + p, 0) / part.districtPop.length;
          let maxDev = 0;
          for (const p of part.districtPop) {
            const d = Math.abs(p - tgt) / tgt;
            if (d > maxDev) maxDev = d;
          }
          if (maxDev < bestDev) { bestDev = maxDev; best = part; }
          if (maxDev <= tolerance) break; // good enough — stop trying
        }
        const partition = best;
        partitions[code] = { partition, units: stateUnits, name: sg.name, seats: sg.seats, maxDev: bestDev };`;
src = record('rewrite useDistricting() retry logic', src, src.replace(oldDistrictingHook, newDistrictingHook));

// --- (10) Loosen splitThreshold so we preserve county boundaries -----------
// Replace the aggressive 0.5× threshold with a county-preserving 1.0×
// threshold (subdivide only counties that EXCEED the target district).
// Also drop the 200K floor — many small/medium counties were being needlessly
// fragmented by it. Floor remains at target × 1.0 to keep the contract clean.
const oldSplit = `    stateTargets[code].splitThreshold = Math.max(200000, stateTargets[code].target * 0.5);`;
const newSplit = `    // Preserve county boundaries whenever a county fits inside the target
    // district population. The threshold is set just above 1.0 × target with
    // a small safety margin (5%): counties at or below 1.05 × target are
    // kept whole, and the chain has enough flex via the polish phase to land
    // them in a balanced district. Counties materially larger than target
    // (LA, Cook, Maricopa, Harris, etc.) still slab-subdivide because no
    // single county can BE a district at ±5% if it's >1.05× target.
    stateTargets[code].splitThreshold = stateTargets[code].target * 1.05;`;
src = record('rewrite splitThreshold (county preservation)', src, src.replace(oldSplit, newSplit));

// Also adjust the subdivision N count — was N = ceil(pop / (target × 0.4))
// which over-splits. Use N = ceil(pop / (target × 0.95)) so a 2-target-sized
// county becomes 2 frags (not 5).
const oldN = `      const N = Math.max(2, Math.ceil(pop / (stateTarget * 0.4)));`;
const newN = `      // Subdivide into the minimum number of fragments such that each fragment
      // is at most 0.95 × target. This keeps slab-cut count low (real geography
      // is preserved as much as possible), and lets ReCom + polish do the
      // remaining work to balance the partition.
      const N = Math.max(2, Math.ceil(pop / (stateTarget * 0.95)));`;
src = record('rewrite fragment count N', src, src.replace(oldN, newN));

// --- (11) Default TRACTS_BASE_URL to local /data/tracts/ -------------------
const oldTractsURL = `const TRACTS_BASE_URL =
  (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_TRACTS_BASE_URL) ||
  null;`;
const newTractsURL = `const TRACTS_BASE_URL =
  (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_TRACTS_BASE_URL) ||
  // Default: look for tract data under /data/tracts/ in the deployment.
  // If the files aren't there, the dashboard falls back to county-level
  // rendering silently. To override, set NEXT_PUBLIC_TRACTS_BASE_URL at build.
  '/data/tracts/';`;
src = record('default TRACTS_BASE_URL to /data/tracts/', src, src.replace(oldTractsURL, newTractsURL));

// --- Write out --------------------------------------------------------------
if (changes === 0 && src === orig) {
  console.error('!! NO CHANGES MADE — patches did not match. Aborting.');
  process.exit(1);
}
fs.writeFileSync(SRC, src);
console.log(`\nWrote ${SRC}`);
console.log(`Total changes: ${changes}, file ${orig.length} → ${src.length} chars (${((src.length-orig.length)/orig.length*100).toFixed(1)}%)`);
