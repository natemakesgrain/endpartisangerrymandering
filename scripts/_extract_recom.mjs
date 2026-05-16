// Marker-based extraction of the ReCom block from Dashboard.jsx →
// scripts/lib/recom.mjs (verbatim, `export` added to the entry points).
// KEEP IN SYNC: re-run after editing the ReCom block in Dashboard.jsx.
import fs from 'node:fs';
const src = fs.readFileSync('components/Dashboard.jsx', 'utf8').split(/\r?\n/);
const a = src.findIndex((l) => /^\/\* -+ DETERMINISTIC PRNG/.test(l));
const b = src.findIndex((l) => /^\/\* -+ ALTERNATIVE PARTITIONERS/.test(l));
if (a < 0 || b < 0 || b <= a) throw new Error('ReCom block markers not found');
let block = src.slice(a, b).join('\n').replace(/\s+$/, '');
for (const f of ['makeRng', 'uniformSpanningTree', 'recomStep',
                 'recomInitialPartition', 'runReCom']) {
  block = block.replace(new RegExp('^function ' + f + '\\(', 'm'),
    'export function ' + f + '(');
}
const hdr =
  '// AUTO-EXTRACTED from components/Dashboard.jsx (DETERMINISTIC PRNG →\n' +
  '// runReCom block) via scripts/_extract_recom.mjs — verbatim except\n' +
  '// `export` added. Pure ReCom, no React/DOM. KEEP IN SYNC.\n\n';
fs.mkdirSync('scripts/lib', { recursive: true });
fs.writeFileSync('scripts/lib/recom.mjs', hdr + block + '\n');
const out = fs.readFileSync('scripts/lib/recom.mjs', 'utf8');
console.log('recom.mjs lines', out.split('\n').length,
  '| exports:', (out.match(/^export function (\w+)/gm) || []).join(', '));
