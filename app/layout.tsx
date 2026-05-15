import './globals.css';
import type { Metadata } from 'next';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

// Absolute base for og:image / twitter:image. Link-preview scrapers
// (iMessage, Slack, X/Twitter, Facebook) require absolute URLs, so this
// must point at the deployed origin. Override at build time with
// NEXT_PUBLIC_SITE_URL when the final domain is known; the fallback is the
// default Netlify subdomain for this repo.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  'https://endpartisangerrymandering.netlify.app';

const OG_DESCRIPTION =
  'A neutral, reproducible algorithm draws all 435 congressional districts from real partisan geography — no map-maker, no partisan input, a published seed. Compare it to the maps that were actually enacted.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'End Partisan Gerrymandering Project',
  description:
    'An algorithmic, reproducible procedure for drawing congressional districts — with a working dashboard, peer-reviewed methodology, and a model statute and constitutional amendment.',
  openGraph: {
    title: 'End Partisan Gerrymandering Project',
    description: OG_DESCRIPTION,
    type: 'website',
    url: SITE_URL,
    siteName: 'End Partisan Gerrymandering Project',
    images: [
      {
        url: '/og-cover.jpg',
        width: 1200,
        height: 630,
        alt: 'A neutral algorithm’s congressional district map of the United States, seed 42, colored by 2024 two-party vote.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'End Partisan Gerrymandering Project',
    description: OG_DESCRIPTION,
    images: ['/og-cover.jpg'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="site">
          <Nav />
          <main style={{ flex: 1 }}>{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
