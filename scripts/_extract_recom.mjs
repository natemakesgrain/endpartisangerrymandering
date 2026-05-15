import fs from 'node:fs';
const src = fs.readFileSync('components/Dashboard.jsx', 'utf8').split(/\r?\n/);
let block = src.slice(1697, 2464).join('\n'); // lines 1698..2464 = ReCom block
for (const f of ['makeRng', 'uniformSpanningTree', 'recomStep', 'recomInitialPartition', 'runReCom']) {
  block = block.replace(new RegExp('^function ' + f + '\\(', 'm'), 'export function ' + f + '(');
}
const header =
  '// AUTO-EXTRACTED from components/Dashboard.jsx (lines 1698-2464), verbatim\n' +
  '// except `export` added to the 5 entry points. Pure ReCom — no React/DOM.\n' +
  '// Used by scripts/build-precincts.mjs to PRE-BAKE precinct district\n' +
  '// assignments with the EXACT algorithm the app runs in-browser, so the\n' +
  '// national precinct view renders baked districts instantly.\n' +
  '// KEEP IN SYNC: if the ReCom block in Dashboard.jsx changes, re-extract\n' +
  '// via: node scripts/_extract_recom.mjs\n\n';
fs.writeFileSync('scripts/lib/recom.mjs', header + block + '\n');
const out = fs.readFileSync('scripts/lib/recom.mjs', 'utf8');
console.log('lines:', out.split('\n').length,
  '| exports:', (out.match(/^export function/gm) || []).length,
  '| fns:', (out.match(/^export function (\w+)/gm) || []).join(', '));
