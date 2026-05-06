/**
 * Query layer for page-channel posts (channel='page').
 *
 * Kept separate from queries/posts.ts (which serves the existing
 * group-channel post UI at /posts and /campaigns/new) because the
 * lifecycle is fundamentally different:
 *   - Group posts: stable user-authored, tied to campaigns + jobs.
 *   - Page posts: AI-generated, awaiting approval, scheduled, single-shot.
 *
 * All queries here filter on `channel='page'` so they never accidentally
 * touch a group-channel row.
 */
import { and, asc, desc, eq, isNull, lte, gt, sql } from 'drizzle-orm';
import { db } from '../index';
import { posts, type Post, type NewPost, type PageApprovalStatus } from '../schema';

/* ------------------------------------------------------------------ */
/* Insert (used by daily generation cron)                              */
/* ------------------------------------------------------------------ */

export interface CreatePagePostInput {
  userId: string;
  pageId: string;
  /**
   * The text we'll seed `posts.text` with — typically the first
   * caption variant. The owner can pick a different one in the queue
   * UI; the final published copy is whatever ends up in `posts.text`
   * after approve.
   */
  initialText: string;
  /** All AI-generated caption variants (3 by default). */
  captionVariants: string[];
  imageUrl: string;
  imagePrompt: string;
  scheduledAt: Date;
}

export async function createPagePost(input: CreatePagePostInput): Promise<Post> {
  const row: NewPost = {
    userId: input.userId,
    text: input.initialText,
    imageUrl: input.imageUrl,
    channel: 'page',
    pageId: input.pageId,
    captionVariants: input.captionVariants,
    imagePrompt: input.imagePrompt,
    approvalStatus: 'pending',
    scheduledAt: input.scheduledAt,
  };
  const [created] = await db.insert(posts).values(row).returning();
  if (!created) throw new Error('Failed to create page post');
  return created;
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

/**
 * The queue UI's main feed — everything pending approval, oldest
 * scheduledAt first so the user works through the backlog top-down.
 */
export async function listPendingPagePostsForUser(
  userId: string,
): Promise<Post[]> {
  return db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.userId, userId),
        eq(posts.channel, 'page'),
        eq(posts.approvalStatus, 'pending'),
      ),
    )
    .orderBy(asc(posts.scheduledAt));
}

/** History view: anything not pending, newest first. */
export async function listPagePostsHistoryForUser(
  userId: string,
  limit = 50,
): Promise<Post[]> {
  return db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.userId, userId),
        eq(posts.channel, 'page'),
        sql`${posts.approvalStatus} <> 'pending'`,
      ),
    )
    .orderBy(desc(posts.scheduledAt))
    .limit(limit);
}

export async function getPagePostForUser(
  userId: string,
  postId: string,
): Promise<Post | null> {
  const [row] = await db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.userId, userId),
        eq(posts.channel, 'page'),
      ),
    )
    .limit(1);
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Approval mutations                                                  */
/* ------------------------------------------------------------------ */

export async function approvePagePost(
  userId: string,
  postId: string,
  finalText: string,
): Promise<Post | null> {
  const [row] = await db
    .update(posts)
    .set({
      text: finalText,
      approvalStatus: 'approved',
      approvedAt: new Date(),
    })
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.userId, userId),
        eq(posts.channel, 'page'),
        eq(posts.approvalStatus, 'pending'),
      ),
    )
    .returning();
  return row ?? null;
}

export async function rejectPagePost(
  userId: string,
  postId: string,
): Promise<Post | null> {
  const [row] = await db
    .update(posts)
    .set({ approvalStatus: 'rejected' })
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.userId, userId),
        eq(posts.channel, 'page'),
        eq(posts.approvalStatus, 'pending'),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Replace one of the caption variants (or the entire array). Caller
 * responsible for length sanity. Used by the regenerate-caption API.
 */
export async function setPagePostCaptions(
  userId: string,
  postId: string,
  captionVariants: string[],
  newPrimaryText?: string,
): Promise<Post | null> {
  const updateSet: Partial<NewPost> = { captionVariants };
  if (newPrimaryText !== undefined) updateSet.text = newPrimaryText;
  const [row] = await db
    .update(posts)
    .set(updateSet)
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.userId, userId),
        eq(posts.channel, 'page'),
      ),
    )
    .returning();
  return row ?? null;
}

export async function setPagePostImage(
  userId: string,
  postId: string,
  imageUrl: string,
  imagePrompt: string,
): Promise<Post | null> {
  const [row] = await db
    .update(posts)
    .set({ imageUrl, imagePrompt })
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.userId, userId),
        eq(posts.channel, 'page'),
      ),
    )
    .returning();
  return row ?? null;
}

export async function reschedulePagePost(
  userId: string,
  postId: string,
  scheduledAt: Date,
): Promise<Post | null> {
  const [row] = await db
    .update(posts)
    .set({ scheduledAt })
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.userId, userId),
        eq(posts.channel, 'page'),
      ),
    )
    .returning();
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Cron-driven helpers (no userId scoping — system-wide)               */
/* ------------------------------------------------------------------ */

/**
 * Used by the publisher cron: approved posts whose scheduledAt has
 * passed and that haven't been published yet (and haven't burned
 * through their retry budget). Index `posts_publish_lookup_idx` makes
 * this O(matched rows).
 */
export async function listPostsReadyToPublish(now: Date = new Date()): Promise<Post[]> {
  return db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.channel, 'page'),
        eq(posts.approvalStatus, 'approved'),
        lte(posts.scheduledAt, now),
        isNull(posts.fbPostId),
      ),
    )
    .orderBy(asc(posts.scheduledAt));
}

/**
 * Used by the skip-stale cron at 09:30: any post still pending whose
 * scheduledAt is more than `gracePeriodMinutes` in the past gets
 * marked 'skipped' so it never publishes late.
 */
export async function listStalePendingPosts(
  graceMinutes: number,
  now: Date = new Date(),
): Promise<Post[]> {
  const cutoff = new Date(now.getTime() - graceMinutes * 60 * 1000);
  return db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.channel, 'page'),
        eq(posts.approvalStatus, 'pending'),
        lte(posts.scheduledAt, cutoff),
      ),
    );
}

export async function markPostSkipped(postId: string): Promise<void> {
  await db
    .update(posts)
    .set({ approvalStatus: 'skipped' })
    .where(eq(posts.id, postId));
}

/* ------------------------------------------------------------------ */
/* Publisher result mutations (cron-internal, no userId)               */
/* ------------------------------------------------------------------ */

export async function markPostPublished(
  postId: string,
  fbPostId: string,
): Promise<void> {
  await db
    .update(posts)
    .set({ approvalStatus: 'published', fbPostId })
    .where(eq(posts.id, postId));
}

/** Bump retry count, returning the new value (for "max retries reached" check). */
export async function bumpRetryCount(postId: string): Promise<number> {
  const [row] = await db
    .update(posts)
    .set({ retryCount: sql`${posts.retryCount} + 1` })
    .where(eq(posts.id, postId))
    .returning({ retryCount: posts.retryCount });
  return row?.retryCount ?? 0;
}

export async function markPostFailed(postId: string): Promise<void> {
  await db
    .update(posts)
    .set({ approvalStatus: 'failed' })
    .where(eq(posts.id, postId));
}

/* Re-export for convenience to API routes */
export type { PageApprovalStatus };
// Silence unused-import noise: these compile-only imports enable inference
// in the queries above.
void gt;
