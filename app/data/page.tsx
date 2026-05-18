import fs from 'fs';
import path from 'path';
import Prose from '@/components/Prose';

export const metadata = {
  title: 'Data & sources — End Partisan Gerrymandering Project',
  description:
    'Every figure on the dashboard and where it comes from: the precinct substrate, which cycles are real versus modeled, how midterm years are extrapolated, the enacted maps, limitations, and full source citations.',
};

export default function DataPage() {
  const raw = fs.readFileSync(
    path.join(process.cwd(), 'content', 'data.md'),
    'utf8'
  );
  const lines = raw.split('\n');
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { bodyStart = i; break; }
  }
  const body = lines.slice(bodyStart).join('\n');

  return (
    <>
      <header className="page-head">
        <p className="page-kicker">Data &amp; sources · plain English</p>
        <h1 className="page-title">What the numbers are, and where they come from.</h1>
        <p className="page-deck">
          Which cycles are real and which are modeled, how the midterm years
          are extrapolated, the enacted maps, the limitations, and every
          source — stated plainly.
        </p>
      </header>
      <Prose>{body}</Prose>
    </>
  );
}
