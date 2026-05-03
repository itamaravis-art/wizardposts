// Revoke a worker token. We do a soft-revoke (set revoked_at) rather than a
// hard delete so historical job rows that reference the token via
// `claimed_by_token` stay intact for auditing.

import { NextResponse } from 'next/server';
import { revokeWorkerTokenForUser } from '@/lib/db/queries/workerTokens';
import { getUserId, handleRouteError } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    const ok = await revokeWorkerTokenForUser(userId, id);
    if (!ok) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
