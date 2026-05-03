// Single campaign + progress + jobs (with group_name joined).

import { NextResponse } from 'next/server';
import {
  getCampaignForUser,
  getCampaignProgressForUser,
} from '@/lib/db/queries/campaigns';
import { listJobsByCampaignForUser } from '@/lib/db/queries/jobs';
import { getUserId, handleRouteError } from '../../_lib/route-helpers';

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
    const [progress, jobs] = await Promise.all([
      getCampaignProgressForUser(userId, id),
      listJobsByCampaignForUser(userId, id),
    ]);
    return NextResponse.json({ ...campaign, progress, jobs });
  } catch (err) {
    return handleRouteError(err);
  }
}
