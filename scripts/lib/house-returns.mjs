/**
 * house-returns.mjs — parse MIT EDSL `data-cache/house_1976-2022.csv`
 * into per-(year, state, district) ACTUAL U.S. House results.
 *
 * Used by the "Enacted" view, which must show the REAL districts colored
 * by the REAL House outcome (so the Enacted seat tally is, by
 * construction, the documented historical result — see methodology §3.6).
 *
 * Correctness matters here at the seat level, so this uses a proper
 * RFC-4180 CSV parser (the dataset has quoted commas inside candidate
 * names — a naive `split(',')` shifts every later column on those rows
 * and silently drops/garbles whole districts). Winner is decided per
 * CANDIDATE (summing every ballot line they appear on — fusion tickets
 * in NY/CT — across all reporting modes), then classified D / R / O.
 */
import { readFileSync } from 'node:fs';

// RFC-4180: fields may be quoted; "" is an escaped quote inside a quoted
// field; commas/newlines are literal inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// The 50 states (postal). Excludes DC + territories — their House
// "members" are non-voting delegates, not part of the 435 and not in
// the enacted-district geometry.
const STATES_50 = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY']);

const isDem = (p) => {
  const u = (p || '').toUpperCase();
  return u === 'DEMOCRAT' || u === 'DEMOCRATIC' ||
    u === 'DEMOCRATIC-FARMER-LABOR' || u === 'DEMOCRATIC-FARM-LABOR' ||
    u === 'DEMOCRATIC-NPL' || u === 'DEMOCRATIC-NONPARTISAN LEAGUE';
};
const isRep = (p) => (p || '').toUpperCase() === 'REPUBLICAN';

/**
 * Returns { [year]: { [state_po]: { [districtNumber]: result } } } where
 * districtNumber is an INTEGER (0 = at-large) and result is:
 *   { winner: 'D'|'R'|'O', d, r, total, dCand, rCand, winCand, winParty }
 * d / r are the two-party candidate totals (each summed across all of
 * that candidate's fusion lines + modes); total is all candidates.
 */
export function loadHouseReturns(csvPath, minYear = 2000) {
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  const H = rows[0];
  const ix = {};
  H.forEach((h, i) => { ix[h.trim()] = i; });
  const col = (f, n) => f[ix[n]];

  // year -> state -> distInt -> candidateName -> {votes, parties:Set}
  const acc = {};
  for (let i = 1; i < rows.length; i++) {
    const f = rows[i];
    if (f.length < H.length) continue;
    const year = +col(f, 'year');
    if (!(year >= minYear)) continue;
    if (col(f, 'stage') !== 'GEN') continue;
    if (String(col(f, 'special')).toUpperCase() === 'TRUE') continue;
    const st = col(f, 'state_po');
    if (!STATES_50.has(st)) continue;          // drop DC / territories
    const dist = parseInt(col(f, 'district'), 10);
    if (st == null || Number.isNaN(dist)) continue;
    const cand = (col(f, 'candidate') || '').trim();
    if (!cand) continue;
    const party = col(f, 'party');
    const votes = +(col(f, 'candidatevotes') || 0) || 0;
    const Y = (acc[year] ||= {});
    const S = (Y[st] ||= {});
    const D = (S[dist] ||= {});
    const C = (D[cand] ||= { votes: 0, parties: new Set() });
    C.votes += votes;
    if (party) C.parties.add(party.toUpperCase());
  }

  const out = {};
  for (const year of Object.keys(acc)) {
    const Yo = (out[year] = {});
    for (const st of Object.keys(acc[year])) {
      const So = (Yo[st] = {});
      for (const dist of Object.keys(acc[year][st])) {
        const cands = acc[year][st][dist];
        let win = null, winV = -1, d = 0, r = 0, total = 0;
        let dCand = null, rCand = null;
        for (const name of Object.keys(cands)) {
          const c = cands[name];
          total += c.votes;
          const dem = [...c.parties].some(isDem);
          const rep = !dem && [...c.parties].some(isRep);
          if (dem && c.votes > d) { d = c.votes; dCand = name; }
          if (rep && c.votes > r) { r = c.votes; rCand = name; }
          if (c.votes > winV) { winV = c.votes; win = { name, dem, rep }; }
        }
        if (!win || total <= 0) continue;          // phantom / empty row
        const winParty = win.dem ? 'D' : win.rep ? 'R' : 'O';
        So[+dist] = {
          winner: winParty, d, r, total,
          dCand, rCand, winCand: win.name,
        };
      }
    }
  }
  return out;
}
