import Dashboard from '@/components/Dashboard';

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div>
          <p className="hero-kicker">A demonstration · 435 districts · 50 states · 2000–2024</p>
          <h1 className="hero-title">
            What if districts were drawn by an <em>algorithm</em>, in public, with a published seed?
          </h1>
          <p className="hero-deck">
            Every line on the map below was placed by a Markov chain, not a
            legislator. Reseed it. Watch the map redraw. Read the methodology
            and the proposed law.
          </p>
        </div>
        <aside className="hero-side">
          <p>
            <strong>How to read this</strong>
            The dashboard is interactive. Pick any cycle 2000–2024 —
            presidential or midterm — click any state for a tract-level
            zoom, and reseed the chain to produce a different valid neutral
            map. Districts are unions of real census tracts and counties.
          </p>
          <p>
            <strong>What it isn&apos;t</strong>
            This is not an existing official map of any state. It is a
            published, reproducible neutral baseline against which real maps
            can be compared. Midterm cycles use a per-state House swing model
            from MIT EDSL state-level returns applied to the nearest
            presidential year&apos;s county pattern (see methodology).
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
