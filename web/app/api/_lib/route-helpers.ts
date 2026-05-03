// Shared route-handler helpers.
//
// Goal: every user-facing route boils down to
//   `const userId = await getUserId();`
// and every error path returns a consistent JSON shape.
//
// We deliberately don't depend on the exact return type of `requireUser` (the
// auth helper is being authored by another agent in parallel). Instead we
// fall back to `auth()` and pull `session.user.id` ourselves, which matches
// the JWT `userId` claim wired in lib/auth/config.ts.

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { auth } from '@/lib/auth';

/**
 * Resolve the current user id from the NextAuth session.
 *
 * Throws an `AuthError` (401) if there is no session. Route handlers should
 * catch this via {@link handleRouteError}.
 */
export async function getUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || typeof userId !== 'string') {
    throw new AuthError();
  }
  return userId;
}

export class AuthError extends Error {
  status = 401;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'AuthError';
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

/**
 * Single error funnel for every route handler.
 *
 * - ZodError      → 400 with formatted issues
 * - AuthError     → 401 Unauthorized
 * - HttpError     → its status + message
 * - everything else → 500 with a generic message (real error logged server-side)
 */
export function handleRouteError(err: unknown): NextResponse | Response {
  // requireWorker (and other auth helpers) throw a raw Response with the
  // appropriate status + WWW-Authenticate header. Pass it through as-is.
  if (err instanceof Response) {
    return err;
  }
  if (err instanceof ZodError) {
    const issues = err.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return NextResponse.json(
      { error: `Validation failed: ${issues}` },
      { status: 400 },
    );
  }
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Unknown errors: log server-side, don't leak internals to the client.
  // eslint-disable-next-line no-console
  console.error('Unhandled route error:', err);
  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 },
  );
}
