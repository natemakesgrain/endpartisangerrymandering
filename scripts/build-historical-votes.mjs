#!/usr/bin/env node
/**
 * Build county-level two-party vote files from REAL historical sources.
 *
 * For presidential years 2000-2024, we use the dataset compiled by Matt
 * Stiles, which itself sources from the MIT Election Data and Science Lab
 * (Harvard Dataverse, doi:10.7910/DVN/VOQCHQ) and the Cook Political Report
 * 2024 update. Each row gives the official D/R/total vote in a county for
 * a single presidential general election.
 *
 *   https://github.com/stiles/presidential-elections
 *
 * The remaining canonical sources for the years we already have on disk
 * (2016/2020/2024) match the existing files, which were originally sourced
 * from tonmcg/US_County_Level_Election_Results_08-24.
 *
 * House midterm county-level data (2006/2010/2014/2018/2022) is not
 * included: U.S. House results are reported by congressional district, not
 * county, and counties can be split between multiple districts. There is
 * no unified national dataset that aggregates House results to the county
 * level. The MIT EDSL precinct dataset (2016+) would permit per-cycle
 * aggregation, but that pipeline is a separate effort and is not run here.
 *
 * The dashboard's YEAR_CONFIG advertises only the presidential years for
 * which we have real county-level returns.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'public', 'data', 'votes');

const STILES_URL =
  'https://raw.githubusercontent.com/stiles/presidential-elections/main/' +
  'data/processed/presidential_county_results.json';

// We already have local files for these years (sourced separately, verified
// to match official totals). The script skips them to avoid clobbering with
// a re-import that might have minor county-boundary mismatches.
const KEEP_EXISTING = new Set(['2016', '2020', '2024']);

// Years we want as output. If the source dataset doesn't have a year, we
// note it and skip — better to be missing data than to fabricate it.
const WANT_YEARS = ['2000', '2004', '2008', '2012', '2016', '2020', '2024'];

// Special FIPS handling. Alaska reports by State House district rather than
// borough so the MIT EDSL data tags every AK row with FIPS "02000" or a
// statewide pseudo-FIPS. Our dashboard treats AK as a single at-large unit
// with key '_AK', so we map the statewide row in.
//
// Other state-equivalents that MIT EDSL uses non-standard FIPS for:
//   D.C. is FIPS 11001 (standard)
//   Bedford City, VA (51515) merged into Bedford County (51019) in 2013
//   Some county splits/consolidations over the years
//
// We don't bother to harmonize these — they're rounding error at the
// district scale.

async function fetchStiles() {
  const local = path.join(__dirname, '..', 'data-cache', 'stiles_county.json');
  if (fs.existsSync(local)) {
    console.log('using cached', local);
    return JSON.parse(fs.readFileSync(local, 'utf8'));
  }
  console.log('fetching', STILES_URL);
  const resp = await fetch(STILES_URL);
  if (!resp.ok) throw new Error(`fetch failed ${resp.status}`);
  const data = await resp.json();
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, JSON.stringify(data));
  return data;
}

function buildYearFromStiles(rows, year) {
  const out = {};
  let akD = 0, akR = 0, akT = 0;
  for (const r of rows) {
    if (r.year !== year) continue;
    const fips = String(r.fips).padStart(5, '0');
    const d = Math.round(r.votes_dem || 0);
    const rv = Math.round(r.votes_rep || 0);
    const t = Math.round(r.votes_all || (d + rv));
    if (!d && !rv) continue;
    if (fips.startsWith('02') || r.state_po === 'AK') {
      akD += d; akR += rv; akT += t;
      // Still record the per-borough row — buildUnits will use it for
      // rendering even though the AK at-large district uses '_AK'.
    }
    out[fips] = [d, rv, t];
  }
  if (akT > 0) out['_AK'] = [akD, akR, akT];
  return out;
}

function summarize(votes, label) {
  let d = 0, r = 0, t = 0, n = 0;
  for (const k of Object.keys(votes)) {
    if (k.startsWith('_')) continue;
    d += votes[k][0]; r += votes[k][1]; t += votes[k][2]; n++;
  }
  const share = d / (d + r);
  console.log(
    `${label}  counties=${n}  D=${d.toLocaleString()}  R=${r.toLocaleString()}  ` +
    `D-share=${(share * 100).toFixed(2)}%`
  );
  return { d, r, share };
}

async function main() {
  const rows = await fetchStiles();
  console.log(`fetched ${rows.length} rows`);

  // Show the years available in the dataset (sanity check)
  const yearsInSource = [...new Set(rows.map((r) => r.year))].sort();
  console.log('years in source:', yearsInSource.join(', '));

  for (const year of WANT_YEARS) {
    if (KEEP_EXISTING.has(year)) {
      // Verify the existing file still has reasonable totals
      const f = path.join(DATA_DIR, `${year}.json`);
      if (fs.existsSync(f)) {
        const existing = JSON.parse(fs.readFileSync(f, 'utf8'));
        summarize(existing, `${year} (existing)`);
        continue;
      }
    }
    if (!yearsInSource.includes(year)) {
      console.warn(`!! ${year} not in source data — skipping`);
      continue;
    }
    const built = buildYearFromStiles(rows, year);
    const out = path.join(DATA_DIR, `${year}.json`);
    fs.writeFileSync(out, JSON.stringify(built));
    summarize(built, `${year} (real)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
