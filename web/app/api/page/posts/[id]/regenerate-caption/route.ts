// POST /api/page/posts/:id/regenerate-caption
// Generates 3 fresh caption variants for an existing pending post.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserId, handleRouteError, HttpError } from '../../../../_lib/route-helpers';
import {
  getPagePostForUser,
  setPagePostCaptions,
} from '@/lib/db/queries/pagePosts';
import { getPageForUser } from '@/lib/db/queries/pages';
import { generateCaptions } from '@/lib/ai/captions';
import type { BrandKit, PillarId } from '@/lib/ai/types';
import { getPillarForSlot } from '@/lib/ai/pillarSchedule';

export const runtime = 'nodejs';
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  // Optional pillar override; if omitted we infer from scheduledAt.
  pillar: z
    .enum(['tips', 'treatments', 'stories', 'education', 'behind_scenes', 'cta'])
    .optional(),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    const post = await getPagePostForUser(userId, id);
    if (!post) throw new HttpError(404, 'Post not found');
    if (!post.pageId) throw new HttpError(400, 'Post has no page binding');
    if (post.approvalStatus !== 'pending') {
      throw new HttpError(400, 'Only pending posts can be regenerated');
    }

    const page = await getPageForUser(userId, post.pageId);
    if (!page) throw new HttpError(404, 'Page not found');
    const brandKit = page.brandKit as BrandKit;

    // Infer pillar from scheduledAt if not provided.
    const pillar: PillarId =
      body.pillar ??
      (post.scheduledAt
        ? (getPillarForSlot(post.scheduledAt, 0, brandKit) ?? 'tips')
        : 'tips');

    const captions = await generateCaptions({ pillar, brandKit, count: 3 });
    const updated = await setPagePostCaptions(userId, id, captions, captions[0]);
    if (!updated) throw new HttpError(500, 'Failed to update post');

    return NextResponse.json({
      ok: true,
      captionVariants: captions,
      text: captions[0],
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
