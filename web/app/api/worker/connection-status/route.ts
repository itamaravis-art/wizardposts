// Worker reports its Facebook connection state to the cloud. The cloud uses
// this to flip `users.fb_connected` / `users.fb_user_name`, which the UI
// reads via /api/me and the dashboard.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireWorker } from '@/lib/auth/worker-auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { handleRouteError } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

const bodySchema = z.object({
  connected: z.boolean(),
  userName: z.string().max(200).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireWorker(req);
    const body = bodySchema.parse(await req.json());

    await db
      .update(users)
      .set({
        fbConnected: body.connected,
        // When disconnecting, clear the cached name so stale data doesn't
        // linger in the UI.
        fbUserName: body.connected ? body.userName ?? null : null,
      })
      .where(eq(users.id, userId));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
