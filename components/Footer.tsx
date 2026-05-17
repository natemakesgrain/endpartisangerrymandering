import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <div className="footer-brand">End Partisan Gerrymandering Project</div>
          <p>
            A demonstration of how congressional districts could be drawn by a
            published, reproducible algorithmic procedure — and a
            model statute and proposed constitutional amendment that would
            require it.
          </p>
          <p style={{ marginTop: 16, fontSize: 12, color: 'var(--ink-faint)' }}>
            Precinct geometry &amp; returns: Dave’s Redistricting / VEST 2020 VTDs.
            District lines: U.S. Census cartographic-boundary CD shapefiles.
            Population: 2020 Decennial P.L. 94-171. House &amp; county returns:
            MIT Election Data and Science Lab.
          </p>
        </div>
        <div>
          <h4>Pages</h4>
          <ul>
            <li><Link href="/">Dashboard</Link></li>
            <li><Link href="/methodology">Methodology</Link></li>
            <li><Link href="/data">Data &amp; sources</Link></li>
            <li><Link href="/legislation">Legislation</Link></li>
          </ul>
        </div>
        <div>
          <h4>References</h4>
          <ul>
            <li><a href="https://rangevoting.org/GerryExamples.html" target="_blank" rel="noopener">Shortest-splitline — W. D. Smith, rangevoting.org</a></li>
            <li><a href="https://hdsr.mitpress.mit.edu/pub/1ds8ptxu" target="_blank" rel="noopener">Recombination — DeFord, Duchin &amp; Solomon (2021)</a></li>
            <li><a href="https://electionlab.mit.edu/data" target="_blank" rel="noopener">MIT Election Data &amp; Science Lab</a></li>
            <li><a href="https://davesredistricting.org/maps#aboutdata" target="_blank" rel="noopener">Dave’s Redistricting — VEST 2020 VTDs</a></li>
            <li><a href="https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html" target="_blank" rel="noopener">U.S. Census cartographic boundary files</a></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
