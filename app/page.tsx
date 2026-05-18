import Dashboard from '@/components/Dashboard';

export default function HomePage() {
  return (
    <article className="feature">
      <header className="feature-head">
        <p className="feature-rubric">A neutral baseline · 435 seats · 2000–2024</p>
        <h1 className="feature-hl">
          What if <em>no one</em> drew the lines?
        </h1>
        <p className="feature-dek">
          Set the districts a state <strong>actually enacted</strong> beside a
          neutral map drawn from the same votes — same voters, no map-maker.
          Pick any cycle from 2000 to 2024; click any state.
        </p>
      </header>

      <Dashboard />

      <section className="feature-explain">
        <h2>What you’re looking at.</h2>
        <div className="explain-cols">
          <section>
            <h3>The enacted map</h3>
            <p>
              The districts a state actually used that cycle — U.S. Census
              shapefiles, colored by the real U.S. House result. Its seat tally
              is the official, documented outcome.
            </p>
            <p><a href="/data">Data &amp; sources →</a></p>
          </section>
          <section>
            <h3>The neutral baselines</h3>
            <p>
              Splitline and ReCom redraw all 435 seats from population and
              geography alone — no map-maker, no partisan or incumbency input,
              reproducible from a published rule.
            </p>
            <p><a href="/methodology">Methodology →</a></p>
          </section>
          <section>
            <h3>What the gap means</h3>
            <p>
              Hold the votes fixed; only the lines change. The distance between
              the enacted plan and a neutral one is the structural effect of
              how the map was drawn.
            </p>
            <p><a href="/legislation">The proposed law →</a></p>
          </section>
        </div>
      </section>
    </article>
  );
}
