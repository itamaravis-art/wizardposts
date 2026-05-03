// List + create campaigns, scoped to the current user.
//
// Creating a campaign also enqueues one job per group. Both the post and the
// groups must already belong to the same user — the *ForUser query helpers
// must enforce this so a malicious client can't reference another user's
// post_id / group_ids.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  listCampaignsForUser,
  createCampaignForUser,
} from '@/lib/db/queries/campaigns';
import { bulkCreateJobsForUser } from '@/lib/db/queries/jobs';
import { getPostForUser } from '@/lib/db/queries/posts';
import { listGroupsForUser } from '@/lib/db/queries/groups';
import {
  getUserId,
  handleRouteError,
  HttpError,
} from '../_lib/route-helpers';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  postId: z.string().uuid(),
  groupIds: z.array(z.string().uuid()).min(1).max(2000),
  dailyCap: z.number().int().positive().max(100).optional(),
  // Safety floor: 60_000 ms (1 minute). Below that FB detects botting almost instantly.
  minDelayMs: z
    .number()
    .int()
    .min(60_000, 'minDelayMs must be at least 60000 (1 minute)')
    .optional(),
  maxDelayMs: z
    .number()
    .int()
    .min(60_000, 'maxDelayMs must be at least 60000 (1 minute)')
    .optional(),
  workHoursStart: z.number().int().min(0).max(23).optional(),
  workHoursEnd: z.number().int().min(0).max(24).optional(),
  textVariations: z.boolean().optional(),
  // ISO 8601. Reject past dates (>1 minute ago).
  scheduledStartAt: z
    .string()
    .datetime({ offset: true })
    .refine((s) => new Date(s).getTime() > Date.now() - 60_000, {
      message: 'scheduledStartAt must be in the future',
    })
    .nullable()
    .optional(),
});

// GET /api/campaigns — all campaigns for current user, with progress + post.
export async function GET() {
  try {
    const userId = await getUserId();
    const campaigns = await listCampaignsForUser(userId);
    return NextResponse.json(campaigns);
  } catch (err) {
    return handleRouteError(err);
  }
}

// POST /api/campaigns — create campaign + jobs in one shot.
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId();
    const body = createSchema.parse(await req.json());

    // Verify referenced post belongs to this user. We do this explicitly here
    // (rather than relying solely on the FK insert to fail) so we can return
    // a clean 400 instead of a generic 500 from a constraint violation.
    const post = await getPostForUser(userId, body.postId);
    if (!post) {
      throw new HttpError(400, `postId ${body.postId} does not exist`);
    }

    // Cross-field sanity on delay window.
    if (
      body.minDelayMs !== undefined &&
      body.maxDelayMs !== undefined &&
      body.minDelayMs > body.maxDelayMs
    ) {
      throw new HttpError(400, 'minDelayMs must be <= maxDelayMs');
    }
    if (
      body.workHoursStart !== undefined &&
      body.workHoursEnd !== undefined &&
      body.workHoursStart >= body.workHoursEnd
    ) {
      throw new HttpError(400, 'workHoursStart must be < workHoursEnd');
    }

    // Verify all referenced groups belong to this user. We list once and
    // intersect — cheaper than a per-id lookup, and avoids leaking which
    // ids exist on the platform via timing.
    const userGroups = await listGroupsForUser(userId);
    const ownedGroupIds = new Set(userGroups.map((g) => g.id));
    const uniqueGroupIds = Array.from(new Set(body.groupIds));
    const unknown = uniqueGroupIds.filter((id) => !ownedGroupIds.has(id));
    if (unknown.length > 0) {
      throw new HttpError(
        400,
        `Unknown or unauthorized group ids: ${unknown.join(', ')}`,
      );
    }

    const campaign = await createCampaignForUser(userId, {
      name: body.name,
      postId: body.postId,
      dailyCap: body.dailyCap,
      minDelayMs: body.minDelayMs,
      maxDelayMs: body.maxDelayMs,
      workHoursStart: body.workHoursStart,
      workHoursEnd: body.workHoursEnd,
      textVariations: body.textVariations,
      scheduledStartAt: body.scheduledStartAt
        ? new Date(body.scheduledStartAt).toISOString()
        : null,
    });

    await bulkCreateJobsForUser(userId, campaign.id, uniqueGroupIds);

    return NextResponse.json(campaign, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
