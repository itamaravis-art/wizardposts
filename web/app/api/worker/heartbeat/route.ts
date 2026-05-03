// Worker heartbeat. The worker pings this every N seconds so the UI can show
// "online" / "last seen 5s ago", and so we can detect dead workers.
//
// This is also the worker's primary "fetch settings" channel — we return the
// user's FB connection state and a small settings blob in the response, so
// the worker doesn't need a separate /settings call.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireWorker } from '@/lib/auth/worker-auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import {
  touchWorkerToken,
  setWorkerTokenName,
} from '@/lib/db/queries/workerTokens';
import { getUserSettings } from '@/lib/db/queries/settings';
import { handleRouteError, HttpError } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

const bodySchema = z
  .object({
    workerName: z.string().min(1).max(80).optional(),
  })
  .optional();

export async function POST(req: NextRequest) {
  try {
    const { userId, tokenId } = await requireWorker(req);

    // Body is optional; tolerate empty / malformed JSON.
    let body: z.infer<typeof bodySchema> = undefined;
    try {
      const json = await req.json();
      body = bodySchema.parse(json);
    } catch {
      body = undefined;
    }

    await touchWorkerToken(tokenId);
    if (body?.workerName) {
      await setWorkerTokenName(tokenId, body.workerName);
    }

    const [user] = await db
      .select({
        fbConnected: users.fbConnected,
        fbUserName: users.fbUserName,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      // Should be impossible — token is FK'd to users with cascade delete —
      // but treat defensively as auth failure rather than 500.
      throw new HttpError(401, 'Token user no longer exists');
    }

    const settings = await getUserSettings(userId);

    return NextResponse.json({
      userId,
      fbConnected: user.fbConnected,
      fbUserName: user.fbUserName,
      settings,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
