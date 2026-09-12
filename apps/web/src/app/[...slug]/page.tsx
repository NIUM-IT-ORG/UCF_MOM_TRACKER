import Link from 'next/link';
import { plannedFor } from '@/lib/roadmap';

/**
 * Catch-all for the screens the build plan has not reached yet.
 *
 * A specific route always wins over a catch-all in the App Router, so this
 * disappears from a path the moment that path's real page.tsx exists. Nothing
 * has to be deleted here for a new screen to take over — though the matching
 * entry in `lib/roadmap.ts` should go, so the sidebar stops marking it.
 */
export default async function Planned({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const path = '/' + slug.join('/');
  const planned = plannedFor(path);

  if (!planned) {
    return (
      <>
        <PageHead eyebrow="Not found" title="There is no page here" />
        <section className="card max-w-[720px]">
          <div className="px-[17px] py-4 text-[13px] text-muted">
            <p className="m-0">
              <code className="text-ink">{path}</code> is not a route in this application.
            </p>
            <p className="mb-0 mt-3">
              <Link href="/">Back to the dashboard</Link>
            </p>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow={planned.phase === null ? 'Not yet scheduled' : `Phase ${planned.phase}`}
        title={planned.title}
      />

      <div className="grid max-w-[1100px] gap-4 md:grid-cols-[1.4fr_1fr]">
        <section className="card">
          <div className="flex items-center gap-2.5 border-b border-line px-[17px] py-[13px]">
            <h3 className="m-0 text-[14.5px] font-bold text-navy">Not built yet</h3>
            <span className="ml-auto font-mono text-[11px] text-muted">{path}</span>
          </div>
          <div className="px-[17px] py-4">
            <p className="mt-0 text-[13.5px] leading-relaxed text-ink">{planned.blurb}</p>

            {planned.phase === null ? (
              <p className="mb-0 mt-4 rounded-lg bg-ice px-3 py-2.5 text-[12.5px] text-muted">
                This one has no ticket yet. It exists in the prototype; raise it when the
                screens around it are done.
              </p>
            ) : (
              <div className="mt-4 rounded-lg bg-ice px-3 py-2.5 text-[12.5px] text-muted">
                Arrives in <b className="text-navy">Phase {planned.phase}</b>
                {planned.tickets.length > 0 && (
                  <>
                    {' '}
                    — tickets{' '}
                    {planned.tickets.map((t, i) => (
                      <span key={t}>
                        {i > 0 && ', '}
                        <b className="font-mono text-navy">{t}</b>
                      </span>
                    ))}
                  </>
                )}{' '}
                in <code>docs/08-BUILD-PLAN.md</code>.
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="flex items-center gap-2.5 border-b border-line px-[17px] py-[13px]">
            <h3 className="m-0 text-[14.5px] font-bold text-navy">See it working</h3>
          </div>
          <div className="px-[17px] py-4 text-[13px] text-muted">
            <p className="m-0">
              This screen already exists, clickable, in{' '}
              <code>prototype/UCF-MoM-Tracker-Interactive.html</code>. Open that file in a
              browser — no server needed — and use it as the reference while the real one is
              built.
            </p>
            <p className="mb-0 mt-3">
              <Link href="/">Back to the dashboard</Link>
            </p>
          </div>
        </section>
      </div>
    </>
  );
}

function PageHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-4">
      <div className="text-[10.5px] font-extrabold uppercase tracking-[2px] text-accent">
        {eyebrow}
      </div>
      <h2 className="mt-0.5 font-serif text-[23px] font-semibold text-navy">{title}</h2>
    </div>
  );
}
