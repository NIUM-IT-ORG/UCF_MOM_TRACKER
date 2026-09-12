import { NextResponse, type NextRequest } from 'next/server';

/**
 * Sends anyone without a session to the sign-in page.
 *
 * This is a convenience, not a security boundary: it only checks that a cookie
 * is present, never that it is valid. Every real check is on the API, where the
 * token is verified and the capabilities are read from the database. Treating
 * this as the guard would mean anyone who can set a cookie in their own browser
 * could walk straight past it.
 */
const PUBLIC_PATHS = ['/login'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const signedIn = req.cookies.has('ucf_at') || req.cookies.has('ucf_rt');
  if (signedIn) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  // Remember where they were headed, so signing in does not dump them on the
  // dashboard when they clicked a link to something specific.
  if (pathname !== '/') url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  /*
   * Pages only.
   *
   * `/api` has to be excluded or this redirects the sign-in request itself to
   * the sign-in page, and nobody can ever sign in - the requests that
   * establish a session necessarily arrive without one. Static assets are
   * excluded because redirecting them achieves nothing but latency.
   */
  matcher: ['/((?!api|_next/static|_next/image|icon.svg|favicon.ico).*)'],
};
