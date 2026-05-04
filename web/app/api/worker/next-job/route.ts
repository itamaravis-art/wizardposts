// Atomic job claim for workers.
//
// The query helper does a single SQL statement of the form:
//
//   UPDATE jobs SET status='running', started_at=now(), claimed_by_token=$tok
//   WHERE id = (
//     SELECT j.id FROM jobs j
//     JOIN campaigns c ON c.id = j.campaign_id
//     WHERE c.user_id = $user
//       AND c.status = 'running'
//       AND j.status = 'pending'
//       AND (j.scheduled_at IS NULL OR j.scheduled_at <= now())
//     ORDER BY j.scheduled_at NULLS FIRST, j.id
//     FOR UPDATE SKIP LOCKED
//     LIMIT 1
//   )
//   RETURNING ...
//
// `FOR UPDATE SKIP LOCKED` makes this safe under multiple concurrent workers
// owned by the same user — each call returns a distinct job (or nothing).
//
// If nothing is pending we return 204 No Content rather than 200 with null,
// so the worker can rely on `response.ok && response.status !== 204`.

import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireWorker } from '@/lib/auth/worker-auth';
import { claimNextJobForUser } from '@/lib/db/queries/jobs';
import { getCampaign } from '@/lib/db/queries/campaigns';
import { getPostForUser } from '@/lib/db/queries/posts';
import { db } from '@/lib/db';
import { groups, shortlinks as shortlinksTbl } from '@/lib/db/schema';
import { alias } from 'drizzle-orm/pg-core';
import { and, eq, sql } from 'drizzle-orm';
import { shortlinkUrl } from '@/lib/shortlinks/urls';
import { handleRouteError } from '../../_lib/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId, tokenId } = await requireWorker(req);
    const claimed = await claimNextJobForUser(userId, tokenId);
    if (!claimed) {
      // 204 No Content — the worker should sleep and retry.
      return new Response(null, { status: 204 });
    }

    // The raw SQL `RETURNING *` from claimNextJobForUser returns snake_case
    // column names (`campaign_id`, `group_id`), NOT Drizzle's camelCase keys.
    // Read with both keys for safety.
    const c = claimed as Record<string, unknown>;
    const campaignId = (c.campaignId ?? c.campaign_id) as string | undefined;
    const groupId = (c.groupId ?? c.group_id) as string | undefined;
    if (!campaignId || !groupId) {
      // Should never happen — bail to a safe 204 rather than 500.
      return new Response(null, { status: 204 });
    }

    // Enrich with campaign + post + group so the worker can post without
    // additional round-trips. Worker expects: { job, campaign, post, group }.
    const campaign = await getCampaign(campaignId, userId);
    const post = campaign ? await getPostForUser(userId, campaign.postId) : null;
    const [group] = await db
      .select()
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);

    // Shortlinks: when the campaign was created we pre-generated child
    // shortlinks for every (post × group) pair where the post text
    // contained one of the user's parent shortlinks. Look those up now
    // and return a `parent_url → child_url` map so the worker can swap
    // them in the post text before typing — that's what gives us
    // per-group click attribution in the dashboard.
    let shortlinkMap: Record<string, string> = {};
    if (post) {
      try {
        // Self-join shortlinks to itself: child rows pointing at this
        // (post, group, user) tuple, with the parent's slug fetched
        // alongside via FK.
        const parent = alias(shortlinksTbl, 'parent');
        const child = alias(shortlinksTbl, 'child');
        const rows = await db
          .select({
            childSlug: child.slug,
            parentSlug: parent.slug,
          })
          .from(child)
          .innerJoin(parent, eq(parent.id, child.parentId))
          .where(
            and(
              eq(child.postId, post.id),
              eq(child.groupId, groupId),
              eq(child.userId, userId),
              eq(parent.isActive, true),
            ),
          );
        for (const r of rows) {
          if (r.childSlug && r.parentSlug) {
            shortlinkMap[shortlinkUrl(r.parentSlug)] = shortlinkUrl(r.childSlug);
          }
        }
      } catch {
        // Best-effort — text goes through unmodified if this fails.
        shortlinkMap = {};
      }
    }

    return NextResponse.json({
      job: {
        id: claimed.id,
        attempts: (c.attempts as number | undefined) ?? 0,
        status: (c.status as string | undefined) ?? 'running',
      },
      campaign: campaign
        ? {
            id: campaign.id,
            name: campaign.name,
            min_delay_ms: campaign.minDelayMs,
            max_delay_ms: campaign.maxDelayMs,
            text_variations: campaign.textVariations,
          }
        : null,
      post: post
        ? {
            id: post.id,
            text: post.text,
            image_url: post.imageUrl,
          }
        : null,
      group: group
        ? {
            id: group.id,
            url: group.url,
            name: group.name,
          }
        : null,
      shortlinks: shortlinkMap,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
