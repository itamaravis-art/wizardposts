// GET /api/page/posts  — list page-channel posts for the queue UI.
// Query: ?status=pending|history (default: pending)

import { NextRequest, NextResponse } from 'next/server';
import { getUserId, handleRouteError } from '../../_lib/route-helpers';
import {
  listPendingPagePostsForUser,
  listPagePostsHistoryForUser,
} from '@/lib/db/queries/pagePosts';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId();
    const status = req.nextUrl.searchParams.get('status') ?? 'pending';
    const rows =
      status === 'history'
        ? await listPagePostsHistoryForUser(userId)
        : await listPendingPagePostsForUser(userId);
    return NextResponse.json(
      rows.map((p) => ({
        id: p.id,
        pageId: p.pageId,
        text: p.text,
        imageUrl: p.imageUrl,
        imagePrompt: p.imagePrompt,
        captionVariants: p.captionVariants,
        approvalStatus: p.approvalStatus,
        approvedAt: p.approvedAt,
        scheduledAt: p.scheduledAt,
        fbPostId: p.fbPostId,
        retryCount: p.retryCount,
        createdAt: p.createdAt,
      })),
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
