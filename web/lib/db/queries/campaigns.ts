import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../index';
import {
  campaigns,
  groups,
  jobs,
  posts,
  type Campaign,
  type CampaignStatus,
} from '../schema';

export async function listCampaignsForUser(userId: string): Promise<Campaign[]> {
  return db
    .select()
    .from(campaigns)
    .where(eq(campaigns.userId, userId))
    .orderBy(desc(campaigns.createdAt));
}

export async function getCampaign(
  id: string,
  userId: string,
): Promise<Campaign | null> {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
    .limit(1);
  return row ?? null;
}

export interface CreateCampaignInput {
  userId: string;
  name: string;
  postId: string;
  groupIds: string[];
  dailyCap?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  workHoursStart?: number;
  workHoursEnd?: number;
  textVariations?: boolean;
  scheduledStartAt?: Date | null;
}

/**
 * Creates a campaign and its jobs in a single transaction.
 *
 * Validates that the post and all groups belong to the same user — if any
 * don't, the transaction rolls back. This prevents a malicious or buggy
 * caller from referencing another tenant's resources.
 */
export async function createCampaign(
  input: CreateCampaignInput,
): Promise<Campaign> {
  return db.transaction(async (tx) => {
    // Verify post ownership.
    const [post] = await tx
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.id, input.postId), eq(posts.userId, input.userId)))
      .limit(1);
    if (!post) throw new Error('Post not found or not owned by user');

    // Verify all groups belong to this user.
    if (input.groupIds.length === 0) {
      throw new Error('At least one group is required');
    }
    const ownedGroups = await tx
      .select({ id: groups.id })
      .from(groups)
      .where(
        and(
          eq(groups.userId, input.userId),
          inArray(groups.id, input.groupIds),
        ),
      );
    if (ownedGroups.length !== input.groupIds.length) {
      throw new Error('One or more groups not found or not owned by user');
    }

    const [campaign] = await tx
      .insert(campaigns)
      .values({
        userId: input.userId,
        name: input.name,
        postId: input.postId,
        dailyCap: input.dailyCap ?? 12,
        minDelayMs: input.minDelayMs ?? 300_000,
        maxDelayMs: input.maxDelayMs ?? 900_000,
        workHoursStart: input.workHoursStart ?? 9,
        workHoursEnd: input.workHoursEnd ?? 22,
        textVariations: input.textVariations ?? false,
        scheduledStartAt: input.scheduledStartAt ?? null,
      })
      .returning();
    if (!campaign) throw new Error('Failed to create campaign');

    await tx.insert(jobs).values(
      input.groupIds.map((groupId) => ({
        campaignId: campaign.id,
        groupId,
      })),
    );

    return campaign;
  });
}

export async function updateCampaignStatus(
  id: string,
  userId: string,
  status: CampaignStatus,
): Promise<Campaign | null> {
  const now = new Date();
  const patch: Partial<typeof campaigns.$inferInsert> = { status };
  if (status === 'running') patch.startedAt = now;
  if (status === 'done' || status === 'cancelled' || status === 'error') {
    patch.finishedAt = now;
  }

  const [row] = await db
    .update(campaigns)
    .set(patch)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
    .returning();
  return row ?? null;
}

export interface CampaignProgress {
  total: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  skipped: number;
}

/**
 * Returns counts of jobs in each status for the campaign. Does not check
 * ownership — pair with `getCampaign` first if exposing to end users.
 */
export async function getCampaignProgress(
  campaignId: string,
): Promise<CampaignProgress> {
  const rows = await db
    .select({
      status: jobs.status,
      count: sql<number>`count(*)::int`,
    })
    .from(jobs)
    .where(eq(jobs.campaignId, campaignId))
    .groupBy(jobs.status);

  const out: CampaignProgress = {
    total: 0,
    pending: 0,
    running: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };
  for (const r of rows) {
    out.total += r.count;
    out[r.status] = r.count;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* *ForUser helpers used by the API layer                             */
/* ------------------------------------------------------------------ */

export const getCampaignForUser = (userId: string, id: string) =>
  getCampaign(id, userId);

export const updateCampaignStatusForUser = (
  userId: string,
  id: string,
  status: CampaignStatus,
) => updateCampaignStatus(id, userId, status);

/**
 * Progress aggregation for a single campaign, scoped to its owner.
 * Returns null if the campaign doesn't exist for this user.
 */
export async function getCampaignProgressForUser(
  userId: string,
  campaignId: string,
): Promise<CampaignProgress | null> {
  const owned = await getCampaign(campaignId, userId);
  if (!owned) return null;
  return getCampaignProgress(campaignId);
}

export interface CreateCampaignForUserInput {
  name: string;
  postId: string;
  dailyCap?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  workHoursStart?: number;
  workHoursEnd?: number;
  textVariations?: boolean;
  /** ISO 8601 string or null. */
  scheduledStartAt?: string | null;
}

/**
 * Create a campaign row for a user. Unlike `createCampaign`, this does NOT
 * insert jobs — the API layer enqueues them separately via
 * `bulkCreateJobsForUser` after validating group ownership.
 *
 * Ownership of `postId` must be verified by the caller.
 */
export async function createCampaignForUser(
  userId: string,
  input: CreateCampaignForUserInput,
): Promise<Campaign> {
  const [campaign] = await db
    .insert(campaigns)
    .values({
      userId,
      name: input.name,
      postId: input.postId,
      dailyCap: input.dailyCap ?? 12,
      minDelayMs: input.minDelayMs ?? 300_000,
      maxDelayMs: input.maxDelayMs ?? 900_000,
      workHoursStart: input.workHoursStart ?? 9,
      workHoursEnd: input.workHoursEnd ?? 22,
      textVariations: input.textVariations ?? false,
      scheduledStartAt: input.scheduledStartAt
        ? new Date(input.scheduledStartAt)
        : null,
    })
    .returning();
  if (!campaign) throw new Error('Failed to create campaign');
  return campaign;
}
