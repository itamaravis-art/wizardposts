// Skip-stale — runs at 09:30 daily.
//
// Any page-channel post still 'pending' whose scheduledAt is more than
// 30 minutes in the past gets marked 'skipped'. This implements the
// rule "if not approved by 09:30, skip — don't publish stale content".
//
// We deliberately use a 30-minute grace window (not 0) so a post
// scheduled for 10:00 isn't skipped at 09:30 — only the morning slot
// from yesterday or earlier.

import { NextRequest } from 'next/server';
import { isAuthorizedCron, cronUnauthorized } from '../../_lib/cronAuth';
import {
  listStalePendingPosts,
  markPostSkipped,
} from '@/lib/db/queries/pagePosts';
import { addLog } from '@/lib/db/queries/logs';
import { notifyOwner } from '@/lib/notifications/greenApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GRACE_MINUTES = 30;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return cronUnauthorized();

  const stale = await listStalePendingPosts(GRACE_MINUTES);
  const skipped: string[] = [];
  for (const post of stale) {
    await markPostSkipped(post.id);
    await addLog({
      userId: post.userId,
      level: 'warn',
      source: 'page-skip-stale-cron',
      message: 'post skipped (passed approval cutoff)',
      meta: {
        postId: post.id,
        pageId: post.pageId,
        scheduledAt: post.scheduledAt,
      },
    }).catch(() => {});
    skipped.push(post.id);
  }

  if (skipped.length > 0) {
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ?? 'https://wizardposts.vercel.app';
    await notifyOwner(
      `🌿 ${skipped.length} פוסטים דולגו (לא אושרו עד 09:30).\n\nקישור: ${baseUrl}/page/queue`,
    );
  }

  return Response.json({ ok: true, skippedCount: skipped.length, skippedIds: skipped });
}
