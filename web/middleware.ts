import { NextResponse, type NextRequest } from 'next/server';
import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth/config';

/**
 * Edge middleware uses a stripped NextAuth instance (no adapter calls,
 * just JWT verification) so it stays edge-compatible.
 */
const { auth } = NextAuth(authConfig);

/** Routes that never require a session. */
const PUBLIC_API_PREFIXES = [
  '/api/auth', // NextAuth's own routes
  '/api/worker', // bearer-token authenticated separately in the route
  '/api/health', // liveness probe
];

const PUBLIC_UI_PREFIXES = [
  '/auth', // sign-in, error, etc.
];

/** Static / framework paths that must never be intercepted. */
function isInternalAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    /\.[a-zA-Z0-9]+$/.test(pathname) // any file extension
  );
}

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function isPublicUi(pathname: string): boolean {
  if (pathname === '/') return true;
  return PUBLIC_UI_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;
  const isAuthed = !!req.auth?.user;

  // 1. Always let static assets and framework routes through.
  if (isInternalAsset(pathname)) {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith('/api');

  // 2. API routes: enforce JSON 401 (except the explicit public list).
  if (isApi) {
    if (isPublicApi(pathname)) {
      return NextResponse.next();
    }
    if (!isAuthed) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Authentication required' },
        { status: 401 },
      );
    }
    return NextResponse.next();
  }

  // 3. UI routes: redirect to sign-in (preserve callbackUrl).
  if (isPublicUi(pathname)) {
    return NextResponse.next();
  }

  if (!isAuthed) {
    const signInUrl = new URL('/auth/signin', nextUrl);
    signInUrl.searchParams.set('callbackUrl', nextUrl.pathname + nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

/**
 * Match everything except Next.js internals and obvious static files.
 * The fine-grained public/private logic lives in the handler above so it
 * stays in one place.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
