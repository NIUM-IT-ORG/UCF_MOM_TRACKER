'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, authApi } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Sign in: password, then a one-time code.
 *
 * The prototype offered role cards so a reviewer could switch designation in
 * one click. This is real authentication, so the cards became a convenience
 * that fills the form — the flow underneath is the same one a real officer
 * uses, and the shortcut disappears outside development.
 */
const DEMO_OFFICERS = [
  { email: 'officer.a@example.gov', name: 'Officer A', role: 'Mission Director', colour: '#BF3B2B' },
  { email: 'officer.c@example.gov', name: 'Officer C', role: 'PDMC', colour: '#D9772B' },
  { email: 'officer.d@example.gov', name: 'Officer D', role: 'Meeting Coordinator · Project 1', colour: '#2E5FA3' },
  { email: 'officer.g@example.gov', name: 'Officer G', role: 'Project Director', colour: '#B2427A' },
  { email: 'officer.h@example.gov', name: 'Officer H', role: 'ULB Nodal Officer', colour: '#7D3C98' },
  { email: 'officer.k@example.gov', name: 'Officer K', role: 'CDMA', colour: '#5E7DAA' },
  { email: 'officer.l@example.gov', name: 'Officer L', role: 'System Administrator', colour: '#64707F' },
  { email: 'officer.b@example.gov', name: 'Officer B', role: 'Additional Mission Director', colour: '#BF3B2B' },
];
const DEMO_PASSWORD = 'ucf-demo-2026';

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useSession();
  // Where they were headed before the middleware sent them here.
  const next = params.get('next') ?? '/';
  const [step, setStep] = useState<'password' | 'otp'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { challengeId: id, devOtp } = await authApi.login(email, password);
      setChallengeId(id);
      setOtp(devOtp ?? '');
      setHint(devOtp ? `Development build — your code is ${devOtp}` : null);
      setStep('otp');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.verifyOtp(challengeId, otp);
      // Fill the session before navigating, so the shell renders signed in on
      // the first paint rather than flashing the signed-out state.
      await refresh();
      router.push(next.startsWith('/') ? next : '/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function pick(officerEmail: string) {
    setEmail(officerEmail);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <div className="flex min-h-screen items-center justify-center overflow-y-auto bg-[linear-gradient(160deg,#142640_0%,#1D3557_55%,#2E5FA3_130%)] p-9">
      <div className="w-full max-w-[1000px]">
        <header className="mb-7 text-center">
          <h1 className="m-0 font-serif text-[26px] font-bold text-white">
            Urban Challenge Fund
          </h1>
          <p className="mt-1.5 text-[12.5px] uppercase tracking-[2.4px] text-[#8FA8CC]">
            Meeting &amp; Action Item Tracker
          </p>
        </header>

        <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
          <section className="rounded-[14px] bg-white p-6 shadow-[0_10px_36px_rgba(0,0,0,.24)]">
            <h2 className="m-0 font-serif text-[18px] font-semibold text-navy">
              {step === 'password' ? 'Sign in' : 'Enter your code'}
            </h2>

            {step === 'password' ? (
              <form onSubmit={submitPassword} className="mt-4">
                <Field label="Email address">
                  <input
                    className="i"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field label="Password">
                  <input
                    className="i"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                {error && <Problem>{error}</Problem>}
                <button className="btn-primary mt-1 w-full" disabled={busy} type="submit">
                  {busy ? 'Checking…' : 'Continue'}
                </button>
              </form>
            ) : (
              <form onSubmit={submitOtp} className="mt-4">
                <p className="mt-0 text-[13px] text-muted">
                  A six-digit code was issued for <b className="text-ink">{email}</b>. It is
                  valid for five minutes.
                </p>
                <Field label="One-time code">
                  <input
                    className="i text-center text-[22px] tracking-[8px]"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  />
                </Field>
                {hint && (
                  <p className="mb-3 rounded-lg bg-ice px-3 py-2 text-[12px] text-muted">{hint}</p>
                )}
                {error && <Problem>{error}</Problem>}
                <button className="btn-primary w-full" disabled={busy} type="submit">
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
                <button
                  type="button"
                  className="mt-2.5 w-full text-[12px] text-muted underline"
                  onClick={() => {
                    setStep('password');
                    setOtp('');
                    setError(null);
                  }}
                >
                  Use a different account
                </button>
              </form>
            )}
          </section>

          <section>
            <h2 className="m-0 text-[10.5px] font-extrabold uppercase tracking-[2px] text-[#8FA8CC]">
              Demo accounts
            </h2>
            <p className="mb-3 mt-1.5 text-[12.5px] text-[#C5D4EA]">
              Seeded officers, all with the password <code>{DEMO_PASSWORD}</code>. Pick one to
              fill the form — the sign-in that follows is the real one.
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {DEMO_OFFICERS.map((o) => (
                <button
                  key={o.email}
                  type="button"
                  onClick={() => pick(o.email)}
                  className={`flex items-start gap-2.5 rounded-[11px] border-0 bg-white p-3 text-left transition-transform hover:-translate-y-0.5 ${
                    email === o.email ? 'ring-2 ring-accent' : ''
                  }`}
                >
                  <span
                    className="grid h-8 w-8 flex-none place-items-center rounded-full text-[11px] font-extrabold text-white"
                    style={{ background: o.colour }}
                    aria-hidden="true"
                  >
                    {o.name.split(' ').map((w) => w[0]).join('')}
                  </span>
                  <span>
                    <b className="block text-[12.5px] leading-tight text-navy">{o.name}</b>
                    <small className="text-[11px] leading-snug text-muted">{o.role}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3.5 block">
      <span className="mb-1.5 block text-[11.5px] font-bold text-navy">{label}</span>
      {children}
    </label>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mb-3 rounded-lg bg-[#FDF3F1] px-3 py-2.5 text-[12.5px] text-danger">
      {children}
    </p>
  );
}
