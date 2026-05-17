#!/usr/bin/env node
/**
 * Build county-level vote files for midterm cycles (2006, 2010, 2014, 2018,
 * 2022) using a "state-level House swing" model.
 *
 * Why a model: U.S. House results are reported by congressional district, not
 * county, and counties can be split between multiple districts. There is no
 * unified national county-level dataset for U.S. House elections — only
 * district-level returns (MIT EDSL) and per-state precinct-level data for
 * 2016+ (which would require a precinct→county crosswalk to aggregate).
 *
 * What we do: for each state and each midterm year, we
 *   1. Read the REAL state-aggregate US House two-party D-share from the
 *      MIT EDSL 1976-2022 dataset (sum of D-vote / sum of D+R-vote across
 *      every district in that state for that year).
 *   2. Find the nearest presidential year's REAL county-level D-share
 *      pattern for that state (2006/2010 → use 2008; 2014/2018 → use 2016;
 *      2022 → use 2020).
 *   3. Apply a per-state logit-space swing to every county in the state so
 *      the population-weighted state D-share matches the actual midterm
 *      House D-share for that state.
 *   4. Hold each county's turnout from the reference year (midterm turnout
 *      patterns aren't modeled — this isn't a turnout study).
 *
 * What this captures vs. doesn't:
 *   ✓ Real state-level partisan swing (2018 California's D shift vs. 2018
 *     Tennessee's D shift differ enormously, and the swing per state here
 *     equals what really happened)
 *   ✓ County-within-state RELATIVE partisanship from the nearest presidential
 *     cycle (the urban-rural divide within each state is preserved)
 *   ✗ Mid-cycle county-LEVEL realignment (a county that swung sharply
 *     between 2016 and 2018 will not have that swing captured if 2018
 *     pulls from the 2016 base — the state swing applies uniformly within
 *     a state)
 *   ✗ Senate / governor races (this models US House only)
 *
 * Midterm seat tallies in the displayed dashboard match the historical
 * record exactly (those are looked up from a separate table; see
 * Dashboard.jsx). Algorithm-generated maps reflect the modeled per-county
 * partisanship, which is why midterm years are labeled "modeled" in the UI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'public', 'data', 'votes');
const HOUSE_CSV = path.join(__dirname, '..', 'data-cache', 'house_1976-2022.csv');
const POP_FILE = path.join(__dirname, '..', 'public', 'data', 'populations.json');

const MIDTERM_YEARS = [2002, 2006, 2010, 2014, 2018, 2022];
const REFERENCE = {
  2002: 2000,
  2006: 2008,
  2010: 2008,
  2014: 2016,
  2018: 2016,
  2022: 2020,
};

// State FIPS → 2-letter postal code (Alaska is special — has no county-level
// House returns, so we read the AK statewide House D-share and apply it).
const STATE_PO = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO',
  '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
  '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY',
};

// ---- 1. Parse the MIT EDSL House CSV ----------------------------------
// CSV has fields: year,state,state_po,...,party,...,candidatevotes,totalvotes
function parseHouseCsv() {
  const raw = fs.readFileSync(HOUSE_CSV, 'utf8');
  const lines = raw.split('\n');
  const header = lines[0].split(',');
  const idx = {};
  header.forEach((h, i) => { idx[h.trim()] = i; });
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // Naive split — fine for this dataset (no quoted commas in the columns
    // we use; only candidate names can contain commas inside quotes, and we
    // don't read candidate name here).
    const fields = line.split(',');
    rows.push({
      year: +fields[idx.year],
      state_po: fields[idx.state_po],
      party: fields[idx.party],
      candidatevotes: +(fields[idx.candidatevotes] || 0),
    });
  }
  return rows;
}

function isDemParty(p) {
  if (!p) return false;
  const up = p.toUpperCase();
  // Major-party Democratic line, INCLUDING the state affiliates that ballot
  // under their own name: Minnesota's DFL ("DEMOCRATIC-FARMER-LABOR", and
  // the "-FARM-LABOR" spelling MIT EDSL uses for some MN cycles) and North
  // Dakota's Dem-NPL ("DEMOCRATIC-NPL" / "DEMOCRATIC-NONPARTISAN LEAGUE").
  // Omitting these silently zeroed ND's Democratic vote (→ a fake ~0 %-D
  // North Dakota in 2014/2018) and undercounted MN 2002.
  return up === 'DEMOCRAT' || up === 'DEMOCRATIC' ||
    up === 'DEMOCRATIC-FARMER-LABOR' || up === 'DEMOCRATIC-FARM-LABOR' ||
    up === 'DEMOCRATIC-NPL' || up === 'DEMOCRATIC-NONPARTISAN LEAGUE';
}
function isRepParty(p) {
  if (!p) return false;
  const up = p.toUpperCase();
  return up === 'REPUBLICAN';
}

function stateHouseDShare(rows, year) {
  // Returns { [state_po]: dShare }
  const acc = {}; // state_po → { d, r }
  for (const r of rows) {
    if (r.year !== year) continue;
    if (!r.state_po || !STATE_PO_TO_FIPS[r.state_po]) continue;
    if (!acc[r.state_po]) acc[r.state_po] = { d: 0, r: 0 };
    if (isDemParty(r.party)) acc[r.state_po].d += r.candidatevotes;
    else if (isRepParty(r.party)) acc[r.state_po].r += r.candidatevotes;
  }
  const out = {};
  for (const po of Object.keys(acc)) {
    const { d, r } = acc[po];
    // A state-aggregate two-party D-share is only meaningful when BOTH
    // major parties actually fielded a candidate somewhere in the state.
    // If no Democrat (or no Republican) ran statewide — single-seat
    // states whose race was R vs. an Independent/Libertarian, or an
    // Independent incumbent: ND 2022 (R vs. Mund-I), SD 2022 (R vs.
    // Libertarian, no D), VT 2002 (Sanders-I, no D) — there is no valid
    // swing target. Omit the state so applyStateSwing() HOLDS the
    // reference presidential pattern, rather than fabricating a
    // uniform ~0 %-D (or ~100 %-D) map from a ballot quirk.
    if (d === 0 || r === 0) continue;
    out[po] = d / (d + r);
  }
  return out;
}

const STATE_PO_TO_FIPS = (() => {
  const out = {};
  for (const [fips, po] of Object.entries(STATE_PO)) out[po] = fips;
  return out;
})();

// ---- 2. Apply per-state logit-swing to base county data ---------------
function logit(p) { return Math.log(p / (1 - p)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function clip(p) { return Math.max(0.005, Math.min(0.995, p)); }

function applyStateSwing(baseVotes, targetByPO, populations) {
  // For each county, compute new D-share by adding a per-state logit delta
  // that makes the state's pop-weighted D-share match targetByPO[state_po].
  // We weight by total VOTES (not population) for the state-level recovery,
  // matching how real D-share is reported.

  // Group counties by state FIPS prefix.
  const byState = {}; // state_po → [{fips, d, r, t, twoP}]
  for (const fips of Object.keys(baseVotes)) {
    if (fips.startsWith('_')) continue;
    const sFips = fips.substring(0, 2);
    const po = STATE_PO[sFips];
    if (!po) continue;
    const [d, r, t] = baseVotes[fips];
    if (d + r === 0) continue;
    if (!byState[po]) byState[po] = [];
    byState[po].push({ fips, d, r, t, twoP: d + r });
  }

  const out = {};
  const stateActualByPO = {};

  for (const po of Object.keys(byState)) {
    const counties = byState[po];
    const target = targetByPO[po];
    if (target === undefined) {
      // No House data for this state in this year (e.g. at-large state with
      // no opposed race, or a state with no D-vs-R contest). Hold the base
      // pattern unchanged.
      for (const c of counties) out[c.fips] = [c.d, c.r, c.t];
      stateActualByPO[po] = computeWeightedShare(counties.map((c) => ({ d: c.d, r: c.r })));
      continue;
    }
    // Bisect logit delta. f(delta) = sum_c sigmoid(logit(p_c) + delta) * twoP_c / sum twoP
    const records = counties.map((c) => ({
      ...c,
      logitD: logit(clip(c.d / c.twoP)),
    }));
    const totalTwoP = records.reduce((s, c) => s + c.twoP, 0);
    function shareAt(delta) {
      let n = 0;
      for (const r of records) n += sigmoid(r.logitD + delta) * r.twoP;
      return n / totalTwoP;
    }
    let lo = -4, hi = 4;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (shareAt(m) < target) lo = m; else hi = m;
    }
    const delta = (lo + hi) / 2;
    for (const c of records) {
      const newP = sigmoid(c.logitD + delta);
      const t = c.twoP; // hold turnout at base
      const newD = Math.round(newP * t);
      out[c.fips] = [newD, t - newD, c.t];
    }
    stateActualByPO[po] = shareAt(delta);
  }

  // Carry over any specials (e.g. _AK statewide pseudo-FIPS — apply AK's swing too)
  for (const k of Object.keys(baseVotes)) {
    if (!k.startsWith('_')) continue;
    if (k === '_AK') {
      const [d, r, t] = baseVotes[k];
      const twoP = d + r;
      const target = targetByPO['AK'];
      if (target !== undefined && twoP > 0) {
        const newP = sigmoid(logit(clip(d / twoP)) + (() => {
          // Recover AK delta from stateActualByPO (cached) or recompute
          return logit(clip(target)) - logit(clip(d / twoP));
        })());
        const newD = Math.round(newP * twoP);
        out[k] = [newD, twoP - newD, t];
      } else {
        out[k] = baseVotes[k];
      }
    } else {
      out[k] = baseVotes[k];
    }
  }

  return { out, stateActualByPO };
}

function computeWeightedShare(rows) {
  let d = 0, r = 0;
  for (const x of rows) { d += x.d; r += x.r; }
  return (d + r) > 0 ? d / (d + r) : 0.5;
}

// ---- 3. Main ----------------------------------------------------------
function main() {
  const houseRows = parseHouseCsv();
  console.log(`Parsed ${houseRows.length} House rows`);

  for (const year of MIDTERM_YEARS) {
    const refYear = REFERENCE[year];
    const refPath = path.join(DATA_DIR, `${refYear}.json`);
    if (!fs.existsSync(refPath)) {
      console.error(`!! Missing reference file ${refPath}; skipping ${year}`);
      continue;
    }
    const baseVotes = JSON.parse(fs.readFileSync(refPath, 'utf8'));
    const targets = stateHouseDShare(houseRows, year);
    const numStates = Object.keys(targets).length;

    // National actual D-share (pop-weighted from district totals)
    let natD = 0, natR = 0;
    for (const r of houseRows) {
      if (r.year !== year) continue;
      if (isDemParty(r.party)) natD += r.candidatevotes;
      else if (isRepParty(r.party)) natR += r.candidatevotes;
    }
    const natShare = (natD + natR) > 0 ? natD / (natD + natR) : null;

    const { out, stateActualByPO } = applyStateSwing(baseVotes, targets, POP_FILE);

    fs.writeFileSync(path.join(DATA_DIR, `${year}.json`), JSON.stringify(out));

    // Verification summary
    let totalD = 0, totalR = 0;
    for (const f of Object.keys(out)) {
      if (f.startsWith('_')) continue;
      totalD += out[f][0]; totalR += out[f][1];
    }
    const recoveredNat = totalD / (totalD + totalR);

    console.log(
      `${year}  ref=${refYear}  states_with_target=${numStates}  ` +
      `actual_national_D=${(natShare * 100).toFixed(2)}%  ` +
      `recovered_national_D=${(recoveredNat * 100).toFixed(2)}%`
    );

    // Spot-check: print 5 swing states
    const checkStates = ['CA', 'TX', 'PA', 'WI', 'MI'];
    for (const st of checkStates) {
      const tgt = targets[st];
      const got = stateActualByPO[st];
      if (tgt === undefined || got === undefined) continue;
      console.log(
        `  ${st}: target=${(tgt * 100).toFixed(1)}%  recovered=${(got * 100).toFixed(1)}%`
      );
    }
  }
}

main();
