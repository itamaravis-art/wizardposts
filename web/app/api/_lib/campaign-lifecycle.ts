// Shared logic for campaign status transitions. Each lifecycle endpoint
// (start/pause/resume/cancel) is a thin wrapper over this helper.

import { NextResponse } from 'next/server';
import {
  getCampaignForUser,
  updateCampaignStatusForUser,
} from '@/lib/db/queries/campaigns';
import type { CampaignStatus } from '@/lib/db/schema';
import { getUserId, handleRouteError } from './route-helpers';

export async function lifecycleHandler(
  campaignId: string,
  target: CampaignStatus,
  allowedFrom: ReadonlyArray<CampaignStatus>,
): Promise<NextResponse> {
  try {
    const userId = await getUserId();
    const campaign = await getCampaignForUser(userId, campaignId);
    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 },
      );
    }
    if (!allowedFrom.includes(campaign.status as CampaignStatus)) {
      return NextResponse.json(
        {
          error: `Cannot transition from '${campaign.status}' to '${target}'`,
        },
        { status: 409 },
      );
    }
    const updated = await updateCampaignStatusForUser(
      userId,
      campaignId,
      target,
    );
    return NextResponse.json(updated);
  } catch (err) {
    return handleRouteError(err);
  }
}
