'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { hasCapability, type Capability } from '@mom/shared';
import { NAV } from './nav';
import { ROADMAP } from '@/lib/roadmap';

interface Props {
  /** Capabilities of the signed-in designation. Empty until Phase 1 wires auth. */
  caps: readonly Capability[];
}

export function Sidebar({ caps }: Props) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="flex flex-none items-center gap-3 border-b border-white/10 px-4 pb-3.5 pt-[18px]">
        <div className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[10px] bg-accent text-white">
          <CalendarMark />
        </div>
        <div>
          <h1 className="m-0 font-serif text-base font-bold text-white">UCF Tracker</h1>
          <span className="mt-0.5 block text-[9.5px] uppercase leading-snug tracking-[1.3px] text-[#8FA8CC]">
            Meetings &amp; action items
          </span>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-[11px] pb-5 pt-2.5">
        {NAV.map((group) => (
          <div key={group.group}>
            <div className="px-3 pb-[5px] pt-3.5 text-[9.5px] font-extrabold uppercase tracking-[1.5px] text-[#7A8FB4]">
              {group.group}
            </div>
            {group.items.map((item) => {
              const locked = item.cap ? !hasCapability(caps, item.cap) : false;
              const active =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              // Marked with the phase that builds it, so the sidebar reads as
              // a plan rather than as a set of broken links.
              const planned = ROADMAP[item.href];
              return (
                <NavLink
                  key={item.href}
                  href={item.href}
                  active={active}
                  locked={locked}
                  phase={planned?.phase}
                >
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex-none border-t border-white/10 px-4 py-[11px] text-[10px] leading-relaxed text-[#7E93B8]">
        Urban Challenge Fund
        <br />
        <b className="text-[#A5BEE3]">Phase 2 · masters</b>
      </div>
    </aside>
  );
}

function NavLink({
  href,
  active,
  locked,
  phase,
  children,
}: {
  href: string;
  active: boolean;
  locked: boolean;
  /** Set when the screen is not built yet; undefined once it ships. */
  phase?: number | null;
  children: React.ReactNode;
}) {
  const base =
    'flex items-center gap-[11px] rounded-[9px] px-3 py-[9px] text-[13px] transition-colors';

  // Locked, not hidden: it renders, it explains itself, and it does not navigate.
  if (locked) {
    return (
      <span
        className={`${base} cursor-not-allowed text-[#C5D4EA] opacity-[.34]`}
        aria-disabled="true"
        title="Your designation does not have access to this"
      >
        {children}
        {phase !== undefined && <PhaseChip phase={phase} />}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      // A screen that is not built yet resolves to the same catch-all page for
      // every route, so prefetching it buys nothing and costs a request per
      // link on every page load.
      prefetch={phase !== undefined ? false : undefined}
      className={`${base} ${
        active ? 'bg-blue text-white' : 'text-[#C5D4EA] hover:bg-white/10 hover:text-white'
      }`}
    >
      {children}
      {phase !== undefined && <PhaseChip phase={phase} />}
    </Link>
  );
}

/** A quiet marker: this screen arrives in a later phase. */
function PhaseChip({ phase }: { phase: number | null }) {
  return (
    <span
      className="ml-auto rounded-full border border-white/20 px-[7px] py-px text-[9.5px] font-bold text-[#8FA8CC]"
      title={
        phase === null
          ? 'Not yet scheduled'
          : `Not built yet - arrives in Phase ${phase}`
      }
    >
      {phase === null ? 'later' : `P${phase}`}
    </span>
  );
}

function CalendarMark() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3"
        y="5"
        width="18"
        height="16"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
