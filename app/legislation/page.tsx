import fs from 'fs';
import path from 'path';
import Prose from '@/components/Prose';

export const metadata = {
  title: 'Legislation — End Partisan Gerrymandering Project',
  description:
    'A model federal statute and proposed constitutional amendment that would require all congressional districts to be drawn by a published, reproducible algorithmic procedure.',
};

export default function LegislationPage() {
  const raw = fs.readFileSync(
    path.join(process.cwd(), 'content', 'legislation.md'),
    'utf8'
  );
  // Strip the original H1; we render the title in the page-head.
  const lines = raw.split('\n');
  let bodyStart = 0;
  for (let i = 1; i < lines.length; i++) {
    // Find the first non-H1, non-blank line that begins the body (the
    // explanatory paragraph, in this document). The first H2 ("Part I")
    // is the natural starting point.
    if (lines[i].startsWith('## ') || lines[i].startsWith('# ')) continue;
    if (lines[i].trim() === '') continue;
    bodyStart = i;
    break;
  }
  // Actually, easier: drop the original H1 line only, keep the rest.
  const stripped = lines.filter((line, idx) => idx === 0 ? false : true).join('\n').trim();

  return (
    <>
      <header className="page-head">
        <p className="page-kicker">A bill · and a proposed amendment</p>
        <h1 className="page-title">Neutral Districting Act of 2026.</h1>
        <p className="page-deck">
          A federal statute Congress could enact today under Article&nbsp;I §&nbsp;4,
          and an Article&nbsp;XXVIII proposal that would entrench the
          principle and extend it to state legislative districts.
        </p>
      </header>
      <Prose wide>{stripped}</Prose>
    </>
  );
}
