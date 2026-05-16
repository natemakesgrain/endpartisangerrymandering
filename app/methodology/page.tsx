import fs from 'fs';
import path from 'path';
import Prose from '@/components/Prose';

export const metadata = {
  title: 'Methodology — End Partisan Gerrymandering Project',
  description:
    'How the dashboard draws districts: data sources, three substrates (counties, fragments, tracts), the shortest-splitline and ReCom algorithms, rendering, and limitations.',
};

export default function MethodologyPage() {
  const raw = fs.readFileSync(
    path.join(process.cwd(), 'content', 'methodology.md'),
    'utf8'
  );
  // Strip the original H1 and the immediate intro line(s); we render those
  // in the page-head block above the prose.
  const lines = raw.split('\n');
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { bodyStart = i; break; }
  }
  const body = lines.slice(bodyStart).join('\n');

  return (
    <>
      <header className="page-head">
        <p className="page-kicker">Technical overview · with citations</p>
        <h1 className="page-title">How the dashboard draws districts.</h1>
        <p className="page-deck">
          Data sources, three substrates, two partitioning algorithms
          (shortest-splitline and ReCom), rendering, and the things these
          methods deliberately do not do.
        </p>
      </header>
      <Prose>{body}</Prose>
    </>
  );
}
