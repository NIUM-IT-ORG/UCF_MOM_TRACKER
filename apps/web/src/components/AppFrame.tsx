'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useSession } from '@/lib/session';

/**
 * The shell — except on the sign-in page, which has no navigation and no
 * signed-in officer to show.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { caps } = useSession();

  if (pathname === '/login') return <>{children}</>;

  return (
    <div className="app-shell">
      <Sidebar caps={caps} />
      <main className="flex min-h-0 min-w-0 flex-col">
        <TopBar />
        <div className="stage">
          <div className="content">{children}</div>
        </div>
      </main>
    </div>
  );
}
