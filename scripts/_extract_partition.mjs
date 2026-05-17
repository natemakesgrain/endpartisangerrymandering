import fs from 'node:fs';
const src = fs.readFileSync('components/Dashboard.jsx', 'utf8').split(/\r?\n/);
const a = src.findIndex((l) => /^function polyAreaOf\(/.test(l));
const b = src.findIndex((l) => /^\/\/ Single entry point the app \+ pipeline/.test(l));
const e = src.findIndex((l, i) => i > b && /^\}/.test(l));
if (a < 0 || b < 0 || e < 0) throw new Error('partitioner block not found');
let block = src.slice(a, e + 1).join('\n');
for (const f of ['polyAreaOf', 'stillConnected', 'rebalance', 'runSeedGrow',
                 '_convexHull', '_chordLen', 'runSplitline', 'runPartition']) {
  block = block.replace(new RegExp('^function ' + f + '\\(', 'm'), 'export function ' + f + '(');
}
const hdr =
  '// AUTO-EXTRACTED from components/Dashboard.jsx (partitioner block) via\n' +
  '// scripts/_extract_partition.mjs — verbatim except `export` added and\n' +
  '// runReCom imported from recom.mjs. KEEP IN SYNC: re-run that script if\n' +
  '// the partitioner block in Dashboard.jsx changes.\n\n' +
  "import { runReCom } from './recom.mjs';\n\n";
fs.mkdirSync('scripts/lib', { recursive: true });
fs.writeFileSync('scripts/lib/partition.mjs', hdr + block + '\n');
const out = fs.readFileSync('scripts/lib/partition.mjs', 'utf8');
// FAIL LOUDLY on silent truncation: the end-marker heuristic (first
// column-0 `}` after the "Single entry point" comment) can truncate if
// the block is reformatted. Import the written module and assert every
// expected entry point is a callable export — a syntax error or a
// missing export throws here instead of shipping a corrupt pipeline lib.
const EXPECTED = ['polyAreaOf', 'stillConnected', 'rebalance', 'runSeedGrow',
  '_convexHull', '_chordLen', 'runSplitline', 'runPartition'];
const mod = await import('./lib/partition.mjs?v=' + Date.now());
const missing = EXPECTED.filter((f) => typeof mod[f] !== 'function');
if (missing.length) throw new Error('partition.mjs extraction corrupt — missing/invalid: ' + missing.join(', '));
console.log('lines', out.split('\n').length,
  '| exports OK:', (out.match(/^export function (\w+)/gm) || []).join(', '));
