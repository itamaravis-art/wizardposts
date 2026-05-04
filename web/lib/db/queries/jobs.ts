/**
 * Job queue queries — atomic claim, success, failure, failure-streak counting.
 *
 * `claimNextJobForUser` uses Postgres `SELECT ... FOR UPDATE SKIP LOCKED`
 * inside an UPDATE so multiple workers can claim concurrently without ever
 * grabbing the same row.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../index';
import { campaigns, groups, jobs, type Job } from '../schema';

/**
 * Atomically claim the oldest pending job that belongs to a `running`
 * campaign owned by `userId`. Returns null if there's nothing to do.
 *
 * The CTE-style subquery in WHERE...IN(...) is the standard Drizzle pattern
 * for "UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)".
 */
export async function claimNextJobForUser(
  userId: string,
  workerTokenId: string,
): Promise<Job | null> {
  // Use Postgres now() rather than passing a JS Date — Drizzle's sql tag
  // doesn't always serialise Date correctly across drivers (we hit
  // "ERR_INVALID_ARG_TYPE: Received an instance of Date" on Vercel + postgres-js).
  const result = await db.execute<Job>(sql`
    UPDATE ${jobs}
    SET
      status = 'running',
      attempts = ${jobs.attempts} + 1,
      started_at = now(),
      claimed_by_token = ${workerTokenId}
    WHERE id = (
      SELECT j.id
      FROM ${jobs} j
      INNER JOIN ${campaigns} c ON c.id = j.campaign_id
      WHERE c.user_id = ${userId}
        AND c.status = 'running'
        AND j.status = 'pending'
        AND (j.scheduled_at IS NULL OR j.scheduled_at <= now())
      ORDER BY j.scheduled_at NULLS FIRST, j.id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *;
  `);

  // db.execute returns either an array (postgres-js) or {rows: [...]} (others).
  const arr = (Array.isArray(result) ? result : (result as { rows?: Job[] }).rows) ?? [];
  return arr[0] ?? null;
}

export async function markJobSuccess(
  jobId: string,
  message: string,
  screenshotUrl?: string | null,
): Promise<Job | null> {
  const [row] = await db
    .update(jobs)
    .set({
      status: 'success',
      finishedAt: new Date(),
      resultMessage: message,
      screenshotPath: screenshotUrl ?? null,
    })
    .where(eq(jobs.id, jobId))
    .returning();
  return row ?? null;
}

export async function markJobFailed(
  jobId: string,
  message: string,
): Promise<Job | null> {
  const [row] = await db
    .update(jobs)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      resultMessage: message,
    })
    .where(eq(jobs.id, jobId))
    .returning();
  return row ?? null;
}

/**
 * Failure kinds that are technical / transient and shouldn't count toward
 * the consecutive-failure streak that pauses the campaign.
 *
 * Why this matters: before iter5 a single DOM-drift on Facebook's side
 * would pause every active campaign across all users — three "Composer
 * trigger not found" failures in a row and the campaign was frozen until
 * a human un-paused it. composer_not_found / network_error are bugs WE
 * fix or transient flakes; they should not be treated like a captcha
 * (which is a real signal that we're being detected).
 */
const TRANSIENT_FAILURE_KINDS = new Set([
  'composer_not_found',
  'composer_no_textbox',
  'network_error',
]);

/**
 * Counts the number of consecutive *non-transient* failed jobs at the tail
 * of the campaign's finished-job timeline. Returns 0 if the most recent
 * finished job is a success. Used to break out of a doomed run after N
 * failures in a row.
 *
 * Transient failures (composer_not_found, network_error) are skipped — they
 * don't reset the streak, but they don't increment it either; effectively
 * they're treated as "didn't happen" for the auto-pause decision. A success
 * after them clears the streak as before.
 *
 * Pre-iter5 rows have `failure_kind = NULL`. We treat those as
 * non-transient (the original behaviour) so pausing logic doesn't change
 * for legacy data.
 */
export async function countConsecutiveFailures(
  campaignId: string,
): Promise<number> {
  const recent = await db
    .select({ status: jobs.status, failureKind: jobs.failureKind })
    .from(jobs)
    .where(
      and(
        eq(jobs.campaignId, campaignId),
        sql`${jobs.status} IN ('success', 'failed')`,
      ),
    )
    .orderBy(desc(jobs.finishedAt));

  let streak = 0;
  for (const r of recent) {
    if (r.status === 'success') break;
    // Transient failures: skip — neither break the streak nor extend it.
    if (r.failureKind && TRANSIENT_FAILURE_KINDS.has(r.failureKind)) continue;
    streak += 1;
  }
  return streak;
}

/* ------------------------------------------------------------------ */
/* *ForUser helpers used by the API layer                             */
/* ------------------------------------------------------------------ */

/**
 * Insert one pending job per group_id for the given campaign. Caller is
 * responsible for verifying ownership of `campaignId` and `groupIds`.
 */
export async function bulkCreateJobsForUser(
  _userId: string,
  campaignId: string,
  groupIds: string[],
): Promise<Job[]> {
  if (groupIds.length === 0) return [];
  return db
    .insert(jobs)
    .values(groupIds.map((groupId) => ({ campaignId, groupId })))
    .returning();
}

/**
 * List jobs for a campaign, scoped to the user that owns the campaign.
 * Returns rows joined with the group's name/url for UI display.
 */
export async function listJobsByCampaignForUser(
  userId: string,
  campaignId: string,
): Promise<(Job & { groupName: string | null; groupUrl: string })[]> {
  const rows = await db
    .select({
      job: jobs,
      groupName: groups.name,
      groupUrl: groups.url,
    })
    .from(jobs)
    .innerJoin(campaigns, eq(jobs.campaignId, campaigns.id))
    .innerJoin(groups, eq(jobs.groupId, groups.id))
    .where(and(eq(jobs.campaignId, campaignId), eq(campaigns.userId, userId)))
    .orderBy(asc(jobs.scheduledAt));

  return rows.map((r) => ({ ...r.job, groupName: r.groupName, groupUrl: r.groupUrl }));
}

export interface RecordJobResultInput {
  jobId: string;
  tokenId: string;
  success: boolean;
  message?: string | null;
  screenshotUrl?: string | null;
  blockerKind?: string | null;
  /**
   * Worker-side classification of the failure (composer_not_found,
   * fb_blocked, etc.). Persisted on the job row so countConsecutiveFailures
   * can tell transient kinds from real ones for the auto-pause decision.
   */
  failureKind?: string | null;
}

/**
 * Record a job's outcome.
 *
 * Verifies the job belongs to a campaign owned by `userId` AND was claimed by
 * the same `tokenId` that's now reporting. Returns null if either check fails.
 *
 * On success, also bumps the group's success_count / last_posted_at; on
 * failure, bumps fail_count.
 */
export async function recordJobResultForUser(
  userId: string,
  input: RecordJobResultInput,
): Promise<Job | null> {
  // Look up the job and its parent campaign in one go to verify ownership +
  // that this token actually claimed it.
  const [row] = await db
    .select({ job: jobs, campaignUserId: campaigns.userId })
    .from(jobs)
    .innerJoin(campaigns, eq(jobs.campaignId, campaigns.id))
    .where(eq(jobs.id, input.jobId))
    .limit(1);

  if (!row) return null;
  if (row.campaignUserId !== userId) return null;
  if (row.job.claimedByToken && row.job.claimedByToken !== input.tokenId) {
    return null;
  }

  const now = new Date();
  const message = input.message ?? (input.success ? 'ok' : (input.blockerKind ?? 'failed'));

  if (input.success) {
    const [updated] = await db
      .update(jobs)
      .set({
        status: 'success',
        finishedAt: now,
        resultMessage: message,
        screenshotPath: input.screenshotUrl ?? null,
      })
      .where(eq(jobs.id, input.jobId))
      .returning();

    // Best-effort group counter bump — separate UPDATE keeps the main path
    // simple and avoids a transaction for a non-critical counter.
    await db
      .update(groups)
      .set({
        successCount: sql`${groups.successCount} + 1`,
        lastPostedAt: now,
      })
      .where(eq(groups.id, row.job.groupId));

    return updated ?? null;
  }

  const [updated] = await db
    .update(jobs)
    .set({
      status: 'failed',
      finishedAt: now,
      resultMessage: message,
      screenshotPath: input.screenshotUrl ?? null,
      failureKind: input.failureKind ?? null,
    })
    .where(eq(jobs.id, input.jobId))
    .returning();

  await db
    .update(groups)
    .set({ failCount: sql`${groups.failCount} + 1` })
    .where(eq(groups.id, row.job.groupId));

  return updated ?? null;
}

// Silence the "unused" lint on inArray — kept imported so future filters can
// use it without re-touching the import line.
void inArray;
