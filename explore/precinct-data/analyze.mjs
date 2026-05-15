// Generalized precinct density-model validation across states.
// For each state: precincts are the finest REAL partisan unit. We test the
// app's core modeling hypothesis directly on precincts:
//   logit(precinct D) - logit(county D)  ≈  W * log(density / county_median)
// and report: best-fit W, R² (share of within-county partisan variation that
// density alone explains), and the precinct D-share RMSE of the current
// W=0.45 model vs precinct ground truth.
import * as shapefile from 'shapefile';

const STATES = [
  { code: 'MI', shp: 'precinct/MI/mi16_results',
    D: 'PRES16D', R: 'PRES16R', POP: 'TOTPOP', county: (p) => String(p.county_fip),
    actual: 'Trump 47.50 / Clinton 47.27 → two-party D 49.88%' },
  { code: 'PA', shp: 'precinct/PA/PA',
    D: 'T16PRESD', R: 'T16PRESR', POP: 'TOTPOP', county: (p) => '42' + p.COUNTYFP10,
    actual: 'Trump 48.18 / Clinton 47.46 → two-party D 49.62%' },
  { code: 'GA', shp: 'precinct/GA/GA_precincts16',
    D: 'PRES16D', R: 'PRES16R', POP: 'TOTPOP', county: (p) => String(p.FIPS1),
    actual: 'Trump 50.77 / Clinton 45.64 → two-party D 47.34%' },
];

function ringArea(r) {
  let a = 0;
  for (let i = 0, n = r.length, j = n - 1; i < n; j = i++)
    a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}
function geomArea(g) {
  if (!g) return 0;
  let a = 0;
  const ps = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  for (const poly of ps) for (let r = 0; r < poly.length; r++)
    a += (r === 0 ? 1 : -1) * Math.abs(ringArea(poly[r]));
  return Math.abs(a);
}

async function analyze(st) {
  const src = await shapefile.open(st.shp + '.shp', st.shp + '.dbf');
  const P = [];
  let totD = 0, totR = 0, totPop = 0, nPop = 0, n = 0;
  let rec = await src.read();
  while (!rec.done) {
    const p = rec.value.properties;
    const d = +p[st.D] || 0, r = +p[st.R] || 0, pop = +p[st.POP] || 0;
    const area = geomArea(rec.value.geometry);
    n++; totD += d; totR += r; totPop += pop; if (pop > 0) nPop++;
    if (d + r > 0 && area > 0)
      P.push({ county: st.county(p), d, r, pop, area, dShare: d / (d + r) });
    rec = await src.read();
  }
  for (const x of P) x.density = x.pop / x.area;

  const byCty = new Map();
  for (const x of P) {
    if (!byCty.has(x.county)) byCty.set(x.county, []);
    byCty.get(x.county).push(x);
  }
  const rows = [];
  for (const [, list] of byCty) {
    const dens = list.map((x) => x.density).filter((v) => v > 0).sort((a, b) => a - b);
    if (dens.length < 4) continue;
    const med = dens[Math.floor(dens.length / 2)];
    let cd = 0, cr = 0;
    for (const x of list) { cd += x.d; cr += x.r; }
    const cShare = cd / (cd + cr);
    if (cShare <= 0.02 || cShare >= 0.98) continue;
    const cLogit = Math.log(cShare / (1 - cShare));
    for (const x of list) {
      if (x.density <= 0) continue;
      const ps = Math.max(0.01, Math.min(0.99, x.dShare));
      rows.push({ y: Math.log(ps / (1 - ps)) - cLogit, x: Math.log(x.density / med), dShare: x.dShare, cShare });
    }
  }
  const N = rows.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const o of rows) { sx += o.x; sy += o.y; sxx += o.x * o.x; sxy += o.x * o.y; syy += o.y * o.y; }
  const mx = sx / N, my = sy / N;
  const W = (sxy - N * mx * my) / (sxx - N * mx * mx);
  const b = my - W * mx;
  let ssT = 0, ssR = 0;
  for (const o of rows) { ssT += (o.y - my) ** 2; ssR += (o.y - (W * o.x + b)) ** 2; }
  const R2 = 1 - ssR / ssT;
  const rmse = (w) => {
    let s = 0;
    for (const o of rows) {
      const pr = 1 / (1 + Math.exp(-(Math.log(o.cShare / (1 - o.cShare)) + w * o.x)));
      s += (pr - o.dShare) ** 2;
    }
    return Math.sqrt(s / N) * 100;
  };
  return {
    code: st.code, n, used: P.length,
    dShare: (100 * totD / (totD + totR)).toFixed(2), actual: st.actual,
    popOK: `${Math.round(totPop).toLocaleString()} (${nPop}/${n} precincts)`,
    W: W.toFixed(3), R2: (R2 * 100).toFixed(1), N,
    rmseUniform: rmse(0).toFixed(2), rmse045: rmse(0.45).toFixed(2), rmseFit: rmse(W).toFixed(2),
  };
}

for (const st of STATES) {
  const r = await analyze(st);
  console.log(`\n================  ${r.code}  ================`);
  console.log(`precincts: ${r.n}  | usable: ${r.used}  | Σpop: ${r.popOK}`);
  console.log(`precinct two-party D-share: ${r.dShare}%   (real: ${r.actual})`);
  console.log(`best-fit W = ${r.W}   (app uses 0.45)`);
  console.log(`R² of density-only model = ${r.R2}%  (within-county partisan variation explained)`);
  console.log(`D-share RMSE  county-uniform ${r.rmseUniform}pp | W=0.45 ${r.rmse045}pp | calibrated(W=${r.W}) ${r.rmseFit}pp`);
}
console.log('\nlower RMSE = closer to precinct truth. county-uniform = the model the');
console.log('app would use with NO within-county adjustment. The gap that remains');
console.log('at the calibrated W is the irreducible error of any density-only model.');
