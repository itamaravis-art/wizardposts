// POST /api/page/posts/:id/regenerate-image
// Re-generates the image (and image prompt) for a pending post.

import { NextRequest, NextResponse } from 'next/server';
import { getUserId, handleRouteError, HttpError } from '../../../../_lib/route-helpers';
import {
  getPagePostForUser,
  setPagePostImage,
} from '@/lib/db/queries/pagePosts';
import { getPageForUser } from '@/lib/db/queries/pages';
import { generateImage } from '@/lib/ai/images';
import { getPillarForSlot } from '@/lib/ai/pillarSchedule';
import type { BrandKit, PillarId } from '@/lib/ai/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const userId = await getUserId();
    const { id } = await params;

    const post = await getPagePostForUser(userId, id);
    if (!post) throw new HttpError(404, 'Post not found');
    if (!post.pageId) throw new HttpError(400, 'Post has no page binding');
    if (post.approvalStatus !== 'pending') {
      throw new HttpError(400, 'Only pending posts can be regenerated');
    }

    const page = await getPageForUser(userId, post.pageId);
    if (!page) throw new HttpError(404, 'Page not found');
    const brandKit = page.brandKit as BrandKit;

    const pillar: PillarId =
      post.scheduledAt
        ? (getPillarForSlot(post.scheduledAt, 0, brandKit) ?? 'tips')
        : 'tips';

    const { url, prompt } = await generateImage({
      pillar,
      brandKit,
      caption: post.text,
      pageId: post.pageId,
      postId: post.id,
    });

    const updated = await setPagePostImage(userId, id, url, prompt);
    if (!updated) throw new HttpError(500, 'Failed to update post');

    return NextResponse.json({ ok: true, imageUrl: url, imagePrompt: prompt });
  } catch (err) {
    return handleRouteError(err);
  }
}
