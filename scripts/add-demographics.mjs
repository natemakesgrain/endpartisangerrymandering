/**
 * add-demographics.mjs — branch-only (explore/precinct-data).
 *
 * Adds 2020-census demographics (P.L. 94-171) to the ALREADY-BUILT
 * public/data/precincts/<fips>.json files WITHOUT re-baking — a fast
 * attribute merge keyed by VTD GEOID, so the existing partitions/geometry
 * are untouched. Per precinct:
 *   dm = [White, Black, Hispanic, Asian, Native, Pacific, VAP_total]
 * (DRA's vtd_data has no gender or age-bracket fields — total vs
 *  voting-age is the demographic ceiling of this source.)
 *
 * Usage: node scripts/add-demographics.mjs            (all built states)
 *        node scripts/add-demographics.mjs MN NV       (subset by USPS)
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const DIR = ROOT + 'public/data/precincts';
const TMP = ROOT + '.dem-tmp';
const SH = { shell: 'bash' };
const bp = (p) => p.replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase());
const sh = (c) => execSync(c, SH);

const want = process.argv.slice(2);
const files = readdirSync(DIR)
  .filter((f) => /^\d+\.json$/.test(f)) // skip *-districts.json
  .sort();

for (const f of files) {
  const path = `${DIR}/${f}`;
  const pj = JSON.parse(readFileSync(path, 'utf8'));
  const st = pj.stateCode;
  if (want.length && !want.includes(st)) continue;
  try {
    mkdirSync(TMP, { recursive: true });
    const zip = `${TMP}/${st}.zip`;
    const url = `https://raw.githubusercontent.com/dra2020/vtd_data/master/2020_VTD/${st}/Geojson_${st}.v06.zip`;
    sh(`curl -sL -o "${bp(zip)}" "${url}"`);
    sh(`cd "${bp(TMP)}" && unzip -o "${st}.zip" -d "${st}" >/dev/null 2>&1`);
    const dir = `${TMP}/${st}`;
    const gjFile = sh(`ls "${bp(dir)}"`).toString().trim().split(/\s+/)
      .find((x) => /datasets\.geojson$/.test(x));
    const gj = JSON.parse(readFileSync(`${dir}/${gjFile}`, 'utf8'));
    const dmById = new Map();
    for (const ft of gj.features) {
      const ds = ft.properties.datasets || {};
      const C = ds.T_20_CENS || {}, VAP = ds.V_20_VAP || {};
      dmById.set(String(ft.properties.id),
        [C.White, C.Black, C.Hispanic, C.Asian, C.Native, C.Pacific, VAP.Total]
          .map((x) => Math.round(x || 0)));
    }
    let hit = 0;
    for (const p of pj.precincts) {
      const dm = dmById.get(String(p.id));
      if (dm) { p.dm = dm; hit++; } else { p.dm = [0, 0, 0, 0, 0, 0, 0]; }
    }
    writeFileSync(path, JSON.stringify(pj));
    const kb = (readFileSync(path).length / 1024) | 0;
    console.log(`  ${st} (${f}): ${hit}/${pj.precincts.length} matched, ${kb} KB`);
  } catch (e) {
    console.log(`  ${st}: FAILED ${e.message}`);
  }
}
if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
console.log('demographics merged →', DIR);
