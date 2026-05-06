// PATCH /api/page/posts/:id  — body: { scheduledAt: ISO string }
//   Reschedule a pending page-channel post to a different time.
//
// GET /api/page/posts/:id  — full row for the queue UI's edit pane.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserId, handleRouteError, HttpError } from '../../../_lib/route-helpers';
import {
  getPagePostForUser,
  reschedulePagePost,
} from '@/lib/db/queries/pagePosts';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  scheduledAt: z.string().datetime(),
});

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    const post = await getPagePostForUser(userId, id);
    if (!post) throw new HttpError(404, 'Post not found');
    return NextResponse.json({
      id: post.id,
      pageId: post.pageId,
      text: post.text,
      imageUrl: post.imageUrl,
      imagePrompt: post.imagePrompt,
      captionVariants: post.captionVariants,
      approvalStatus: post.approvalStatus,
      approvedAt: post.approvedAt,
      scheduledAt: post.scheduledAt,
      fbPostId: post.fbPostId,
      retryCount: post.retryCount,
      createdAt: post.createdAt,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    const body = patchSchema.parse(await req.json());
    const updated = await reschedulePagePost(userId, id, new Date(body.scheduledAt));
    if (!updated) throw new HttpError(404, 'Post not found');
    return NextResponse.json({ ok: true, scheduledAt: updated.scheduledAt });
  } catch (err) {
    return handleRouteError(err);
  }
}
