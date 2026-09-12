'use client';

import { useEffect, useState } from 'react';
import { CAPABILITIES, ALL_CAPABILITIES, type Capability } from '@mom/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Health {
  ok: boolean;
  database: string;
}

/**
 * Phase 1's demo surface.
 *
 * The dashboard proper arrives in Phase 6. Until then this shows the thing
 * Phase 1 is actually for: who you are, what your designation lets you do, and
 * which projects those powers reach. Sign in as four officers and this page
 * says four different things — which is the whole acceptance test.
 */
export default function Page() {
  const { user } = useSession();
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    api<Health>('/health/ready')
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const held = new Set(user?.caps ?? []);

  return (
    <>
      <div className="mb-4">
        <div className="text-[10.5px] font-extrabold uppercase tracking-[2px] text-accent">
          Phase 1 · identity and access
        </div>
        <h2 className="mt-0.5 font-serif text-[23px] font-semibold text-navy">
          {user ? `Signed in as ${user.name}` : 'Not signed in'}
        </h2>
        {user && (
          <p className="mt-1.5 max-w-[820px] text-[13.5px] text-muted">
            {user.designation.name} · {user.department.name}. Capabilities come from the
            designation and are re-read on every request, so an access change takes effect
            without signing out.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <section className="card">
          <div className="flex items-center gap-2.5 border-b border-line px-[17px] py-[13px]">
            <h3 className="m-0 text-[14.5px] font-bold text-navy">What this designation can do</h3>
            <span className="ml-auto text-[11px] text-muted">
              {held.size} of {ALL_CAPABILITIES.length}
            </span>
          </div>
          <div className="grid gap-x-5 gap-y-1 px-[17px] py-4 sm:grid-cols-2">
            {ALL_CAPABILITIES.map((cap) => (
              <CapabilityRow key={cap} cap={cap} held={held.has(cap)} />
            ))}
          </div>
        </section>

        <div className="grid gap-4 content-start">
          <section className="card">
            <div className="flex items-center gap-2.5 border-b border-line px-[17px] py-[13px]">
              <h3 className="m-0 text-[14.5px] font-bold text-navy">Project scope</h3>
            </div>
            <div className="px-[17px] py-4 text-[13px]">
              {!user ? (
                <p className="m-0 text-muted">Sign in to see your scope.</p>
              ) : user.seesAllProjects || held.has('view_all_projects') ? (
                <p className="m-0">
                  <b className="text-navy">Every project.</b>
                  <span className="mt-1.5 block text-[12.5px] text-muted">
                    Lists are unfiltered for this officer.
                  </span>
                </p>
              ) : user.projectIds.length === 0 ? (
                <p className="m-0 text-danger">
                  No projects mapped — every list will be empty. That is the usual answer to
                  &ldquo;why can&rsquo;t this officer see anything&rdquo;.
                </p>
              ) : (
                <>
                  <p className="m-0 text-muted">
                    Mapped to {user.projects.length} project
                    {user.projects.length === 1 ? '' : 's'}. Everything else returns
                    &ldquo;not found&rdquo; — never &ldquo;forbidden&rdquo;, so ids cannot be
                    probed.
                  </p>
                  <ul className="mb-0 mt-2 list-none space-y-1 p-0 text-[12.5px]">
                    {user.projects.map((p) => (
                      <li key={p.id}>
                        <b className="font-mono text-[11px] text-accent">{p.code}</b>{' '}
                        <span className="text-navy">{p.name}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </section>

          <section className="card">
            <div className="flex items-center gap-2.5 border-b border-line px-[17px] py-[13px]">
              <h3 className="m-0 text-[14.5px] font-bold text-navy">Services</h3>
            </div>
            <div className="px-[17px] py-4">
              <Row label="Web (Next.js)" value="running" good />
              <Row label="API (NestJS)" value={health ? 'reachable' : 'not reachable'} good={!!health} />
              <Row
                label="Database (PostgreSQL)"
                value={health?.database ?? 'unknown'}
                good={health?.database === 'up'}
              />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function CapabilityRow({ cap, held }: { cap: Capability; held: boolean }) {
  return (
    <div className="flex items-baseline gap-2.5 border-b border-line py-1.5 last:border-0">
      <span
        aria-hidden="true"
        className="text-[13px] font-bold"
        style={{ color: held ? 'var(--ok)' : '#C3CCD8' }}
      >
        {held ? '✓' : '·'}
      </span>
      <span className={held ? 'text-[12.5px] text-ink' : 'text-[12.5px] text-muted opacity-60'}>
        {CAPABILITIES[cap]}
        <span className="sr-only">{held ? ' — held' : ' — not held'}</span>
      </span>
    </div>
  );
}

function Row({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2.5 last:border-0">
      <span className="text-[13px]">{label}</span>
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
        style={{
          background: good ? '#E6F4EC' : '#FBEBE8',
          color: good ? 'var(--ok)' : 'var(--danger)',
        }}
      >
        <i className="h-[7px] w-[7px] rounded-full" style={{ background: 'currentColor' }} aria-hidden="true" />
        {value}
      </span>
    </div>
  );
}
