/**
 * Vercel Cron auth helper.
 *
 * Vercel adds `Authorization: Bearer <CRON_SECRET>` to every cron
 * invocation when the env var is set. We reject anything else with 401
 * so cron endpoints can sit at public paths without becoming a public
 * API surface.
 *
 * In dev (no CRON_SECRET set) we allow requests through so you can
 * curl them locally. Production REQUIRES CRON_SECRET to be set or the
 * cron will reject Vercel's invocation too — fail-closed.
 */
import { NextRequest } from 'next/server';

export function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Dev mode — let curl through. In Vercel always set this env.
    if (process.env.NODE_ENV === 'production') return false;
    return true;
  }
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${expected}`;
}

export function cronUnauthorized() {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}
