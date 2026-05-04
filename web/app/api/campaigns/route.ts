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
  toSnake,
} from '../_lib/route-helpers';

export const runtime = 'nodejs';

// Accept BOTH camelCase and snake_case field names (UI sends snake_case to
// match the rest of the app; API was originally written camelCase). Pre-process
// to normalise before validation so neither side has to care.
const createSchema = z.preprocess(
  (raw) => {
    if (typeof raw !== 'object' || raw === null) return raw;
    const r = raw as Record<string, unknown>;
    const norm = (...keys: string[]) => {
      for (const k of keys) if (r[k] !== undefined) return r[k];
      return undefined;
    };
    return {
      name: r.name,
      postId: norm('postId', 'post_id'),
      groupIds: norm('groupIds', 'group_ids'),
      dailyCap: norm('dailyCap', 'daily_cap'),
      minDelayMs: norm('minDelayMs', 'min_delay_ms'),
      maxDelayMs: norm('maxDelayMs', 'max_delay_ms'),
      workHoursStart: norm('workHoursStart', 'work_hours_start'),
      workHoursEnd: norm('workHoursEnd', 'work_hours_end'),
      textVariations: norm('textVariations', 'text_variations'),
      scheduledStartAt: norm('scheduledStartAt', 'scheduled_start_at'),
    };
  },
  z.object({
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
  }),
);

// GET /api/campaigns — all campaigns for current user, enriched with the
// post (text + image_url) and a job-status progress summary so the UI can
// render cards without a per-campaign extra fetch.
export async function GET() {
  try {
    const userId = await getUserId();
    const campaigns = await listCampaignsForUser(userId);

    // Resolve posts in one shot.
    const uniquePostIds = Array.from(new Set(campaigns.map((c) => c.postId)));
    const postMap = new Map<string, { id: string; text: string; imageUrl: string | null }>();
    for (const pid of uniquePostIds) {
      const p = await getPostForUser(userId, pid);
      if (p) {
        postMap.set(p.id, { id: p.id, text: p.text, imageUrl: p.imageUrl ?? null });
      }
    }

    // Per-campaign progress (single aggregated query).
    const { db } = await import('@/lib/db');
    const { jobs } = await import('@/lib/db/schema');
    const { eq, sql, inArray } = await import('drizzle-orm');
    const campaignIds = campaigns.map((c) => c.id);
    let progressRows: Array<{ campaignId: string; status: string; n: number }> = [];
    if (campaignIds.length > 0) {
      progressRows = (await db
        .select({
          campaignId: jobs.campaignId,
          status: jobs.status,
          n: sql<number>`count(*)::int`,
        })
        .from(jobs)
        .where(inArray(jobs.campaignId, campaignIds))
        .groupBy(jobs.campaignId, jobs.status)) as typeof progressRows;
    }
    const progressByCampaign = new Map<string, { total: number; done: number; success: number; failed: number; pending: number }>();
    for (const r of progressRows) {
      const cur = progressByCampaign.get(r.campaignId) ?? { total: 0, done: 0, success: 0, failed: 0, pending: 0 };
      cur.total += r.n;
      if (r.status === 'success') { cur.success += r.n; cur.done += r.n; }
      else if (r.status === 'failed') { cur.failed += r.n; cur.done += r.n; }
      else if (r.status === 'pending') { cur.pending += r.n; }
      progressByCampaign.set(r.campaignId, cur);
    }

    // The dashboard / campaigns pages read `c.started_at`, `c.created_at`,
    // `c.last_error`, `c.daily_cap`, etc. — full snake_case. Drizzle gives us
    // camelCase, so convert at the wire boundary.
    const enriched = campaigns.map((c) => {
      const p = progressByCampaign.get(c.id) ?? { total: 0, done: 0, success: 0, failed: 0, pending: 0 };
      const post = postMap.get(c.postId);
      const snakeC = toSnake<Record<string, unknown>>(c);
      return {
        ...snakeC,
        post: post
          ? { id: post.id, text: post.text, imageUrl: post.imageUrl, image_path: post.imageUrl }
          : null,
        progress: p,
        total_jobs: p.total,
        done_jobs: p.done,
      };
    });

    return NextResponse.json(enriched);
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

    // Per-(post×group) shortlinks for click attribution. If the post text
    // contains any of this user's parent shortlinks, we pre-create child
    // shortlinks for every group this campaign will hit. Worker swaps the
    // parent URL for the group-specific child URL at posting time, so a
    // click on "wzp.co/may-sale" in group A becomes "wzp.co/xK7m" — the
    // dashboard can then show clicks-per-group attribution.
    //
    // Best-effort: if shortlink expansion fails (e.g. parent shortlink
    // rows missing), we log but don't fail campaign creation. The text
    // will go out as-is and clicks just won't be group-attributed.
    try {
      const { ensureChildShortlinksForGroups } = await import(
        '@/lib/db/queries/shortlinks'
      );
      const { getPostForUser } = await import('@/lib/db/queries/posts');
      const post = await getPostForUser(userId, body.postId);
      if (post?.text) {
        await ensureChildShortlinksForGroups(
          userId,
          body.postId,
          post.text,
          uniqueGroupIds,
        );
      }
    } catch (err) {
      // Log only — don't fail the campaign create over a tracking-side issue.
      console.error('shortlink expansion failed:', err);
    }

    return NextResponse.json(toSnake(campaign), { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
