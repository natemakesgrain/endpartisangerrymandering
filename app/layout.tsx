import './globals.css';
import type { Metadata } from 'next';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'End Partisan Gerrymandering Project',
  description:
    'An algorithmic, reproducible procedure for drawing congressional districts — with a working dashboard, peer-reviewed methodology, and a model statute and constitutional amendment.',
  openGraph: {
    title: 'End Partisan Gerrymandering Project',
    description:
      'Algorithmic congressional redistricting: dashboard, methodology, and proposed legislation.',
    type: 'website',
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
