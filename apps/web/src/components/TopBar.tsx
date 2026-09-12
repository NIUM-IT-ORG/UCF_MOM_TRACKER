'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from './nav';
import { useSession } from '@/lib/session';
import { useCrumbTail } from '@/lib/crumb';

/**
 * The breadcrumb is derived from the route rather than passed in, so it can
 * never sit there saying "Dashboard" on a page that is not the dashboard. The
 * one thing the route cannot give is a record's name, which the detail screen
 * supplies through the crumb context once it has loaded it.
 */
function useCrumb(): { section: string; page: string; href: string } {
  const pathname = usePathname();
  if (pathname === '/') return { section: 'Overview', page: 'Dashboard', href: '/' };

  const first = '/' + (pathname.split('/').filter(Boolean)[0] ?? '');
  for (const group of NAV) {
    const item = group.items.find((i) => i.href === first);
    if (item) return { section: group.group, page: item.label, href: first };
  }
  return { section: 'UCF Tracker', page: 'Not found', href: first };
}

/** A stable colour per designation, so the same officer always looks the same. */
const BAND_COLOUR: Record<string, string> = {
  MD: '#BF3B2B',
  AMD: '#BF3B2B',
  PDMC: '#D9772B',
  MC: '#2E5FA3',
  PD: '#B2427A',
  ULB: '#7D3C98',
  CDMA: '#5E7DAA',
  SYS: '#64707F',
  EXT: '#8C857A',
};

export function TopBar() {
  const { section, page, href } = useCrumb();
  const tail = useCrumbTail();
  const { user, signOut } = useSession();

  return (
    <header className="flex min-h-[60px] flex-none flex-wrap items-center gap-3 border-b border-line bg-card px-[22px] py-[9px]">
      <nav aria-label="Breadcrumb" className="min-w-0 text-[12.5px] text-muted">
        {/* "Meetings / Meetings / …" reads like a bug. When the group and the
            item share a name, one of them is enough. */}
        {section !== page && (
          <>
            {section}
            <Separator />
          </>
        )}
        {tail ? (
          <>
            <Link href={href} className="text-muted hover:text-blue">
              {page}
            </Link>
            <Separator />
            <b className="text-ink">{tail}</b>
          </>
        ) : (
          <b className="text-ink">{page}</b>
        )}
      </nav>

      <div className="ml-auto flex flex-wrap items-center gap-[9px]">
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-navy"
          aria-label="Notifications"
        >
          <BellIcon />
        </button>

        {user ? (
          <>
            <div className="flex items-center gap-[9px] rounded-[22px] border border-line bg-white py-[5px] pl-[5px] pr-3">
              <span
                className="grid h-[29px] w-[29px] place-items-center rounded-full text-[11px] font-bold text-white"
                style={{ background: BAND_COLOUR[user.designation.code] ?? '#5E7DAA' }}
                aria-hidden="true"
              >
                {user.initials}
              </span>
              <span>
                <b className="block text-xs leading-tight">{user.name}</b>
                <small className="text-[9.5px] font-bold text-accent">
                  {user.designation.name}
                </small>
              </span>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-[9px] border border-line bg-white px-3 py-2 text-[12px] font-semibold text-navy hover:border-steel"
            >
              Sign out
            </button>
          </>
        ) : (
          <a href="/login" className="text-[12px] font-semibold">
            Sign in
          </a>
        )}
      </div>
    </header>
  );
}

function Separator() {
  return (
    <span aria-hidden="true" className="px-1.5 text-line">
      /
    </span>
  );
}

function BellIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.7 21a2 2 0 0 1-3.4 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
