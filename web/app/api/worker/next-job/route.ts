// Atomic job claim for workers.
//
// The query helper does a single SQL statement of the form:
//
//   UPDATE jobs SET status='running', started_at=now(), claimed_by_token=$tok
//   WHERE id = (
//     SELECT j.id FROM jobs j
//     JOIN campaigns c ON c.id = j.campaign_id
//     WHERE c.user_id = $user
//       AND c.status = 'running'
//       AND j.status = 'pending'
//       AND (j.scheduled_at IS NULL OR j.scheduled_at <= now())
//     ORDER BY j.scheduled_at NULLS FIRST, j.id
//     FOR UPDATE SKIP LOCKED
//     LIMIT 1
//   )
//   RETURNING ...
//
// `FOR UPDATE SKIP LOCKED` makes this safe under multiple concurrent workers
// owned by the same user — each call returns a distinct job (or nothing).
//
// If nothing is pending we return 204 No Content rather than 200 with null,
// so the worker can rely on `response.ok && response.status !== 204`.

import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireWorker } from '@/lib/auth/worker-auth';
import { claimNextJobForUser } from '@/lib/db/queries/jobs';
import { handleRouteError } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { userId, tokenId } = await requireWorker(req);
    const claimed = await claimNextJobForUser(userId, tokenId);
    if (!claimed) {
      // 204 No Content — the worker should sleep and retry.
      return new Response(null, { status: 204 });
    }
    // Expected shape: { job, campaign, post (with text + image_url), group }
    return NextResponse.json(claimed);
  } catch (err) {
    return handleRouteError(err);
  }
}
