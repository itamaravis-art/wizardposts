/**
 * GET /api/worker/next-recheck
 *
 * Picks the oldest job that:
 *   - belongs to a campaign owned by the worker's user
 *   - is currently `success` with result_message looking like
 *     "Pending moderator approval ..."
 *   - finished at least 2 hours ago
 *   - never been rechecked, OR rechecked more than 6 hours ago
 *
 * Returns 204 if nothing to recheck. Otherwise returns:
 *   { jobId, groupUrl, finishedAt, lastRecheckedAt }
 *
 * The worker visits `groupUrl`, takes a fresh screenshot, uploads it
 * via /api/worker/upload-screenshot, then calls /api/worker/report-recheck
 * with the resulting URL. The cloud GPT-4o classifier then decides
 * whether the post is now visible (admin approved) or still pending.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq, and, isNull, lt, sql } from 'drizzle-orm';
import { requireWorker } from '@/lib/auth/worker-auth';
import { db } from '@/lib/db';
import { jobs, campaigns, groups } from '@/lib/db/schema';
import { handleRouteError } from '../../_lib/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireWorker(req);
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

    const candidates = await db
      .select({
        jobId: jobs.id,
        groupUrl: groups.url,
        finishedAt: jobs.finishedAt,
        lastRecheckedAt: sql<Date | null>`${jobs.lastRecheckedAt}`,
      })
      .from(jobs)
      .innerJoin(campaigns, eq(campaigns.id, jobs.campaignId))
      .innerJoin(groups, eq(groups.id, jobs.groupId))
      .where(
        and(
          eq(campaigns.userId, userId),
          eq(jobs.status, 'success'),
          sql`${jobs.resultMessage} ~* 'pending moderator|pending approval|ממתין לאישור|אישור מנהל'`,
          lt(jobs.finishedAt, twoHoursAgo),
          sql`(${jobs.lastRecheckedAt} IS NULL OR ${jobs.lastRecheckedAt} < ${sixHoursAgo.toISOString()}::timestamptz)`,
        ),
      )
      .orderBy(jobs.lastRecheckedAt, jobs.finishedAt)
      .limit(1);

    if (candidates.length === 0) {
      return new NextResponse(null, { status: 204 });
    }
    const job = candidates[0]!;
    return NextResponse.json({
      jobId: job.jobId,
      groupUrl: job.groupUrl,
      finishedAt: job.finishedAt,
      lastRecheckedAt: job.lastRecheckedAt,
    });
  } catch (err) {
    // last_rechecked_at column might not exist yet on some envs; surface
    // gracefully so the worker just skips the recheck step.
    if (err && typeof err === 'object' && 'message' in err && typeof (err as Error).message === 'string') {
      const m = (err as Error).message;
      if (m.includes('last_rechecked_at') || m.includes('column "last_rechecked_at"')) {
        return new NextResponse(null, { status: 204 });
      }
    }
    return handleRouteError(err);
  }
}
