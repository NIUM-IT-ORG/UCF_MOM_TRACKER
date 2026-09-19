'use client';

import { useId, useState } from 'react';
import Link from 'next/link';

/**
 * A status breakdown, as a ring with the total in the middle.
 *
 * The form the client picked from the wireframe, built to hold up rather than
 * merely resemble it. Three things it does deliberately:
 *
 * 1. **No magnitude is read from an angle.** Every segment's count *and* its
 *    share are printed in the legend beside it. The ring carries the shape of
 *    the whole and the total in the middle — which is the number people quote
 *    in a review meeting — and the legend carries the figures.
 *
 * 2. **The colours are ordered so that touching segments are far apart.** The
 *    ring order is blue → red → amber → green, which clears the colour-blind
 *    separation check on every adjacent pair; the same four hues in their
 *    natural order would not. The amber is under 3:1 against white on its own,
 *    and the relief for that is exactly the visible labels above.
 *
 * 3. **The segments are separated by a gap in the surface colour, not by a
 *    stroke.** A stroke around a mark reads as another mark.
 *
 * Four segments is the ceiling here. A fifth status would mean re-checking the
 * palette, not adding a colour.
 */
export interface Slice {
  key: string;
  label: string;
  value: number;
  colour: string;
  href: string;
}

const SIZE = 168;
const STROKE = 26;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
/** 2px of surface between touching segments, expressed as arc length. */
const GAP = 2;

export function Donut({
  slices,
  total,
  totalLabel = 'Total',
  empty,
}: {
  slices: Slice[];
  total: number;
  totalLabel?: string;
  empty: string;
}) {
  const titleId = useId();
  const [hover, setHover] = useState<string | null>(null);

  if (total === 0) return <p className="m-0 text-[12.5px] text-muted">{empty}</p>;

  const drawn = slices.filter((s) => s.value > 0);
  const share = (v: number) => (v / total) * 100;

  let offset = 0;
  const arcs = drawn.map((s) => {
    const length = (s.value / total) * C;
    const arc = {
      ...s,
      // The gap is taken off the end of each segment. With one segment at 100%
      // there is nothing to separate, so it keeps its full circumference.
      dash: drawn.length === 1 ? length : Math.max(length - GAP, 1),
      offset,
    };
    offset += length;
    return arc;
  });

  const active = hover ? drawn.find((s) => s.key === hover) : null;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-labelledby={titleId}
        >
          <title id={titleId}>
            {totalLabel}: {total}.{' '}
            {drawn.map((s) => `${s.label} ${s.value}`).join(', ')}.
          </title>
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {/* The track, so a nearly-empty ring still reads as a ring. */}
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke="#EDF1F6"
              strokeWidth={STROKE}
            />
            {arcs.map((a) => (
              <circle
                key={a.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                stroke={a.colour}
                strokeWidth={STROKE}
                strokeDasharray={`${a.dash} ${C - a.dash}`}
                strokeDashoffset={-a.offset}
                opacity={hover && hover !== a.key ? 0.35 : 1}
                style={{ transition: 'opacity .12s' }}
                onMouseEnter={() => setHover(a.key)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <div className="text-[30px] font-extrabold leading-none tabular-nums text-navy">
            {active ? active.value : total}
          </div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-[1.4px] text-muted">
            {active ? active.label : totalLabel}
          </div>
        </div>
      </div>

      {/*
        The legend is not decoration — it is where the figures live. Identity
        never rests on colour: each row carries a swatch, the name, the count
        and the share, and clicking it opens the register filtered to it.
      */}
      <ul className="m-0 min-w-[210px] flex-1 list-none space-y-1.5 p-0">
        {slices.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              className="grid grid-cols-[10px_1fr_auto_44px] items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-[#F4F7FB]"
              onMouseEnter={() => setHover(s.value > 0 ? s.key : null)}
              onMouseLeave={() => setHover(null)}
            >
              <span
                aria-hidden
                className="block h-[10px] w-[10px] rounded-sm"
                style={{ background: s.colour, opacity: s.value === 0 ? 0.35 : 1 }}
              />
              <span className="text-[12.5px] text-ink">{s.label}</span>
              <b className="text-right text-[13px] tabular-nums text-navy">{s.value}</b>
              <span className="text-right text-[11.5px] tabular-nums text-muted">
                {s.value === 0 ? '—' : `${Math.round(share(s.value))}%`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
