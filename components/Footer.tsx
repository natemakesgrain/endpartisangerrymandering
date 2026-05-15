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
            Geometry: 2020 U.S. Census cartographic boundary files. Population:
            2020 Decennial P1. Election results: MIT Election Data and Science
            Lab.
          </p>
        </div>
        <div>
          <h4>Pages</h4>
          <ul>
            <li><Link href="/">Dashboard</Link></li>
            <li><Link href="/methodology">Methodology</Link></li>
            <li><Link href="/legislation">Legislation</Link></li>
          </ul>
        </div>
        <div>
          <h4>Sources</h4>
          <ul>
            <li><a href="https://hdsr.mitpress.mit.edu/pub/1ds8ptxu" target="_blank" rel="noopener">DeFord, Duchin, Solomon (2021)</a></li>
            <li><a href="https://www.census.gov/programs-surveys/decennial-census/about/rdo.html" target="_blank" rel="noopener">U.S. Census P.L. 94-171</a></li>
            <li><a href="https://electionlab.mit.edu/" target="_blank" rel="noopener">MIT Election Lab</a></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
