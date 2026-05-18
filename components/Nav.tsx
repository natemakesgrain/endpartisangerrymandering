'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/methodology', label: 'Methodology' },
  { href: '/data', label: 'Data' },
  { href: '/legislation', label: 'Legislation' },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="nav-brand" aria-label="End Partisan Gerrymandering Project — home">
          <span className="nav-brand-mark">E&nbsp;P&nbsp;G&nbsp;P</span>
          <span>End Partisan Gerrymandering Project</span>
        </Link>
        <div className="nav-links">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`nav-link ${pathname === l.href ? 'active' : ''}`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
