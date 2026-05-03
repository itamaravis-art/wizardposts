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
export function handleRouteError(err: unknown): NextResponse {
  // requireWorker (and other auth helpers) throw a raw Response that already
  // contains the proper JSON body, status, and WWW-Authenticate header. We
  // wrap it in a NextResponse without remarshaling so the descriptive
  // `message` from the auth helper survives.
  if (err instanceof Response) {
    return new NextResponse(err.body, {
      status: err.status,
      headers: err.headers,
    });
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

/* ------------------------------------------------------------------ */
/* Serialization helpers                                              */
/*                                                                    */
/* Drizzle's `.select()` returns objects keyed by the JS column name  */
/* (camelCase). The dashboard / pages all expect snake_case wire      */
/* shapes (matching `web/lib/types.ts`). These helpers convert at the */
/* API boundary so we don't have to rewrite every query.              */
/* ------------------------------------------------------------------ */

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

/**
 * Recursively rewrite an object's keys from camelCase to snake_case.
 *
 * - Date instances are converted to ISO strings (so they survive JSON.stringify
 *   in a stable shape; some callers like Vercel Serverless will do this anyway,
 *   but doing it explicitly keeps tests deterministic).
 * - `Date | null` → `string | null`
 * - boolean `active`-style fields are LEFT as booleans; UI code that treats
 *   `active === 1` should be tolerated by sending both `active` (bool) and the
 *   caller can decide. We don't 0/1-coerce here to avoid lying about types.
 * - Arrays are mapped element-wise.
 * - Anything that isn't a plain object/array/Date is returned unchanged.
 */
export function toSnake<T = unknown>(value: unknown): T {
  if (value === null || value === undefined) return value as T;
  if (value instanceof Date) return value.toISOString() as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => toSnake(v)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[camelToSnake(k)] = toSnake(v);
    }
    return out as T;
  }
  return value as T;
}
