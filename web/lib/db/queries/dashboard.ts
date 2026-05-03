/**
 * Aggregated dashboard payload for the home page.
 *
 * One round-trip; the route handler is a thin wrapper over this. Shape mirrors
 * `DashboardData` in `web/lib/types.ts` (snake_case for the wire format) so
 * the client can consume it directly.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../index';
import {
  campaigns,
  groups,
  jobs,
  logs,
  type Campaign,
  type Job,
} from '../schema';
import { getTodayCount } from './counters';
import { getUserSettings } from './settings';

export interface DashboardActiveCampaign extends Campaign {
  total_jobs: number;
  done_jobs: number;
}

export interface DashboardRecentJob extends Job {
  group_name: string | null;
  group_url: string;
}

export interface DashboardPayload {
  today_count: number;
  daily_cap: number;
  active_campaigns: DashboardActiveCampaign[];
  recent_jobs: DashboardRecentJob[];
  recent_errors: Array<{
    id: string;
    level: 'info' | 'warn' | 'error';
    source: string;
    message: string;
    meta: unknown;
    created_at: Date;
  }>;
  fb_connected: 0 | 1;
  fb_user_name: string | null;
  // Extras consumed by the dashboard page when present.
  success_count: number;
  fail_count: number;
  pending_jobs: number;
  yesterday_count: number;
  work_hours_start: number;
  work_hours_end: number;
}

const RECENT_JOBS_LIMIT = 25;
const RECENT_ERRORS_LIMIT = 10;

/**
 * Build the aggregated dashboard payload for a user. Sub-queries run in
 * parallel; everything is scoped by `userId` either directly or via a join
 * through `campaigns`.
 */
export async function getDashboardForUser(
  userId: string,
): Promise<DashboardPayload> {
  const [
    todayCount,
    settings,
    activeCampaignsRaw,
    recentJobsRaw,
    recentErrors,
    aggregateCounts,
    yesterdayCount,
  ] = await Promise.all([
    getTodayCount(userId),
    getUserSettings(userId),
    // Active campaigns + per-campaign job counters via subqueries.
    db
      .select({
        campaign: campaigns,
        total_jobs: sql<number>`(
          SELECT count(*)::int FROM ${jobs} j WHERE j.campaign_id = ${campaigns.id}
        )`,
        done_jobs: sql<number>`(
          SELECT count(*)::int FROM ${jobs} j
          WHERE j.campaign_id = ${campaigns.id}
            AND j.status IN ('success', 'failed', 'skipped')
        )`,
      })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.userId, userId),
          sql`${campaigns.status} IN ('running', 'paused')`,
        ),
      )
      .orderBy(desc(campaigns.createdAt)),
    // Recent jobs across all of the user's campaigns, with group display info.
    db
      .select({
        job: jobs,
        group_name: groups.name,
        group_url: groups.url,
      })
      .from(jobs)
      .innerJoin(campaigns, eq(jobs.campaignId, campaigns.id))
      .innerJoin(groups, eq(jobs.groupId, groups.id))
      .where(eq(campaigns.userId, userId))
      .orderBy(
        desc(sql`coalesce(${jobs.finishedAt}, ${jobs.startedAt}, ${jobs.scheduledAt})`),
      )
      .limit(RECENT_JOBS_LIMIT),
    // Most recent error logs.
    db
      .select({
        id: logs.id,
        level: logs.level,
        source: logs.source,
        message: logs.message,
        meta: logs.meta,
        created_at: logs.createdAt,
      })
      .from(logs)
      .where(and(eq(logs.userId, userId), eq(logs.level, 'error')))
      .orderBy(desc(logs.createdAt))
      .limit(RECENT_ERRORS_LIMIT),
    // Total success/fail/pending across all of the user's jobs.
    db
      .select({
        status: jobs.status,
        count: sql<number>`count(*)::int`,
      })
      .from(jobs)
      .innerJoin(campaigns, eq(jobs.campaignId, campaigns.id))
      .where(eq(campaigns.userId, userId))
      .groupBy(jobs.status),
    // Yesterday's posted count = jobs that finished successfully yesterday (UTC).
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .innerJoin(campaigns, eq(jobs.campaignId, campaigns.id))
      .where(
        and(
          eq(campaigns.userId, userId),
          eq(jobs.status, 'success'),
          sql`${jobs.finishedAt} >= (current_date - interval '1 day')`,
          sql`${jobs.finishedAt} < current_date`,
        ),
      ),
  ]);

  let success_count = 0;
  let fail_count = 0;
  let pending_jobs = 0;
  for (const row of aggregateCounts) {
    if (row.status === 'success') success_count = row.count;
    else if (row.status === 'failed') fail_count = row.count;
    else if (row.status === 'pending' || row.status === 'running') {
      pending_jobs += row.count;
    }
  }

  return {
    today_count: todayCount,
    daily_cap: settings.daily_cap,
    active_campaigns: activeCampaignsRaw.map((r) => ({
      ...r.campaign,
      total_jobs: r.total_jobs,
      done_jobs: r.done_jobs,
    })),
    recent_jobs: recentJobsRaw.map((r) => ({
      ...r.job,
      group_name: r.group_name,
      group_url: r.group_url,
    })),
    recent_errors: recentErrors,
    fb_connected: settings.fb_connected ? 1 : 0,
    fb_user_name: settings.fb_user_name,
    success_count,
    fail_count,
    pending_jobs,
    yesterday_count: yesterdayCount[0]?.count ?? 0,
    work_hours_start: settings.work_hours_start,
    work_hours_end: settings.work_hours_end,
  };
}
