import Dashboard from '@/components/Dashboard';

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div>
          <p className="hero-kicker">435 districts · 50 states · 2000–2024</p>
          <h1 className="hero-title">
            What if the map were drawn from the <em>geography</em>, not the politics?
          </h1>
          <p className="hero-deck">
            Set the districts a state actually enacted beside a neutral map
            drawn from the same ground — same voters, no map-maker. The gap
            is the gerrymander.
          </p>
        </div>
        <aside className="hero-side">
          <p>
            <strong>How to read this</strong>
            Pick any cycle from 2000 to 2024. Switch between the{' '}
            <em>enacted</em> map and two neutral baselines. Click any state
            to zoom in and read it district by district.
          </p>
          <p>
            <strong>What it isn&apos;t</strong>
            The neutral maps are not any state&apos;s official plan — they
            are reproducible baselines for comparison. Cycles without real
            precinct returns are modeled from official county results;
            which cycles, and how, is set out in full on the Methodology
            and Data pages.
          </p>
        </aside>
      </section>

      <div className="section-mark" aria-hidden="true">The dashboard</div>

      <div className="dashboard-envelope">
        <Dashboard />
      </div>
    </>
  );
}
