import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { SessionUser } from '@mom/shared';
import { AppFrame } from '@/components/AppFrame';
import { SessionProvider } from '@/lib/session';
import './globals.css';

export const metadata: Metadata = {
  title: 'UCF Meeting & Action Item Tracker',
  description:
    'Every commitment made in a meeting, written down with named officers and a date, and tracked until it is confirmed done.',
};

/**
 * Resolves the session on the server, so the first paint already knows who is
 * signed in. Without this the navigation renders empty-handed for a moment and
 * every capability-gated item flashes locked before settling.
 */
async function currentUser(): Promise<SessionUser | null> {
  const cookie = cookies().toString();
  if (!cookie) return null;
  try {
    const base = process.env.API_URL ?? 'http://localhost:4000';
    const res = await fetch(`${base}/api/v1/auth/me`, {
      headers: { cookie },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data: SessionUser };
    return body.data;
  } catch {
    // The API not being up is not a reason to fail the page; the dashboard
    // reports it, and the sign-in page still works.
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bitter:wght@500;600;700&family=Public+Sans:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body>
        <SessionProvider initialUser={user}>
          <AppFrame>{children}</AppFrame>
        </SessionProvider>
      </body>
    </html>
  );
}
