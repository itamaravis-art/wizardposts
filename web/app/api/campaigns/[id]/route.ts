// Single campaign + progress + jobs (with group_name joined).

import { NextResponse } from 'next/server';
import {
  getCampaignForUser,
  getCampaignProgressForUser,
} from '@/lib/db/queries/campaigns';
import { listJobsByCampaignForUser } from '@/lib/db/queries/jobs';
import { getUserId, handleRouteError, toSnake } from '../../_lib/route-helpers';
import { getPostForUser } from '@/lib/db/queries/posts';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    const campaign = await getCampaignForUser(userId, id);
    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 },
      );
    }
    const [progress, jobs, post] = await Promise.all([
      getCampaignProgressForUser(userId, id),
      listJobsByCampaignForUser(userId, id),
      getPostForUser(userId, campaign.postId),
    ]);
    // Snake-case the entire payload — UI reads `data.started_at`, `j.finished_at`,
    // `j.group_name`, `data.last_error`, etc. Embed the original camelCase
    // `imageUrl` on `post` because the page also reads `data.post.imageUrl`.
    return NextResponse.json({
      ...toSnake<Record<string, unknown>>(campaign),
      progress,
      jobs: toSnake(jobs),
      post: post
        ? { id: post.id, text: post.text, imageUrl: post.imageUrl, image_path: post.imageUrl }
        : null,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
