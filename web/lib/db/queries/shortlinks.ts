/**
 * Shortlink CRUD + click attribution queries.
 *
 * Two roles share the `shortlinks` table:
 *   - PARENT (parent_id IS NULL): user-created via /shortlinks/new.
 *     Has a stable slug the user pastes into post text.
 *   - CHILD  (parent_id IS NOT NULL): auto-created when a campaign
 *     starts and the post text contains a parent shortlink. One child
 *     per (parent × group). Worker text-replaces parent URL with this
 *     child URL when posting to that group, which is what gives us
 *     per-group click attribution.
 *
 * The redirect endpoint /l/<slug> resolves either form by slug.
 */
import { and, desc, eq, isNull, sql, count, inArray } from 'drizzle-orm';
import { db } from '../index';
import {
  shortlinks,
  shortlinkClicks,
  groups,
  type Shortlink,
} from '../schema';
import { autoSlug } from '@/lib/shortlinks/slug';

/* ------------------------------------------------------------------ */
/* Resolution (used by /l/[slug])                                      */
/* ------------------------------------------------------------------ */

/**
 * Resolve a slug to a row. For child rows we also reject if the parent
 * has been deactivated (so disabling a parent revokes every per-group
 * child URL it spawned).
 */
export async function getShortlinkBySlug(slug: string): Promise<Shortlink | null> {
  const [row] = await db
    .select()
    .from(shortlinks)
    .where(eq(shortlinks.slug, slug))
    .limit(1);
  if (!row) return null;
  if (row.parentId) {
    const [parent] = await db
      .select({ isActive: shortlinks.isActive })
      .from(shortlinks)
      .where(eq(shortlinks.id, row.parentId))
      .limit(1);
    if (parent && !parent.isActive) return null;
  }
  return row;
}

/** Increment counters; safe to call best-effort (caller `void`s the promise). */
export async function bumpClickCount(
  shortlinkId: string,
  isBot: boolean,
): Promise<void> {
  if (isBot) {
    await db
      .update(shortlinks)
      .set({ botClickCount: sql`${shortlinks.botClickCount} + 1` })
      .where(eq(shortlinks.id, shortlinkId));
  } else {
    await db
      .update(shortlinks)
      .set({ clickCount: sql`${shortlinks.clickCount} + 1` })
      .where(eq(shortlinks.id, shortlinkId));
  }
}

export interface RecordClickInput {
  shortlinkId: string;
  ipHash?: string | null;
  userAgent?: string | null;
  country?: string | null;
  deviceType?: string | null;
  referrer?: string | null;
  isBot: boolean;
}

export async function recordClick(input: RecordClickInput): Promise<void> {
  await db.insert(shortlinkClicks).values({
    shortlinkId: input.shortlinkId,
    ipHash: input.ipHash ?? null,
    userAgent: input.userAgent ?? null,
    country: input.country ?? null,
    deviceType: input.deviceType ?? null,
    referrer: input.referrer ?? null,
    isBot: input.isBot,
  });
}

/* ------------------------------------------------------------------ */
/* Parent (user-facing) CRUD                                           */
/* ------------------------------------------------------------------ */

export interface CreateParentInput {
  userId: string;
  targetUrl: string;
  customSlug?: string | null;
  label?: string | null;
}

/**
 * Create a parent shortlink. If `customSlug` is provided, use it (caller
 * should have already validated it). Otherwise generate auto slugs and
 * retry on collision up to 5 times.
 *
 * Returns the new row, or throws if customSlug is taken.
 */
export async function createParentShortlink(
  input: CreateParentInput,
): Promise<Shortlink> {
  const useCustom = !!input.customSlug;
  const maxAttempts = useCustom ? 1 : 5;
  let lastErr: unknown = null;

  for (let i = 0; i < maxAttempts; i++) {
    const slug = useCustom ? input.customSlug! : autoSlug();
    try {
      const [row] = await db
        .insert(shortlinks)
        .values({
          userId: input.userId,
          slug,
          targetUrl: input.targetUrl,
          label: input.label ?? null,
        })
        .returning();
      if (!row) throw new Error('Insert returned no row');
      return row;
    } catch (err) {
      lastErr = err;
      // Unique constraint violation on slug? Try a fresh auto slug.
      const msg = err instanceof Error ? err.message : String(err);
      if (useCustom || !/duplicate key|unique/i.test(msg)) {
        throw err;
      }
      // else loop and retry
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('autoSlug collisions exhausted');
}

/** List the user's parent shortlinks (newest first), with click totals. */
export async function listParentShortlinksForUser(
  userId: string,
): Promise<Array<Shortlink & { campaignCount: number }>> {
  const rows = await db
    .select({
      shortlink: shortlinks,
      // child shortlinks are auto-created per campaign so counting
      // distinct parent_id↔post pairs ≈ "active in N campaigns".
      campaignCount: count(sql`DISTINCT child.post_id`).as('campaign_count'),
    })
    .from(shortlinks)
    .leftJoin(
      sql`shortlinks child`,
      sql`child.parent_id = ${shortlinks.id}`,
    )
    .where(and(eq(shortlinks.userId, userId), isNull(shortlinks.parentId)))
    .groupBy(shortlinks.id)
    .orderBy(desc(shortlinks.createdAt));

  return rows.map((r) => ({ ...r.shortlink, campaignCount: Number(r.campaignCount) }));
}

export async function getParentShortlinkForUser(
  userId: string,
  id: string,
): Promise<Shortlink | null> {
  const [row] = await db
    .select()
    .from(shortlinks)
    .where(
      and(
        eq(shortlinks.id, id),
        eq(shortlinks.userId, userId),
        isNull(shortlinks.parentId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function setShortlinkActive(
  userId: string,
  id: string,
  isActive: boolean,
): Promise<boolean> {
  const result = await db
    .update(shortlinks)
    .set({ isActive })
    .where(and(eq(shortlinks.id, id), eq(shortlinks.userId, userId)))
    .returning({ id: shortlinks.id });
  return result.length > 0;
}

/* ------------------------------------------------------------------ */
/* Per-group attribution (the headline feature)                        */
/* ------------------------------------------------------------------ */

export interface PerGroupClickRow {
  groupId: string | null;
  groupName: string | null;
  groupUrl: string | null;
  childSlug: string | null;
  postsCount: number;       // how many child shortlinks (≈ posts) for this group
  totalClicks: number;
  uniqueClickers: number;
  botClicks: number;
}

/**
 * For a parent shortlink, return click attribution grouped by the FB
 * group that drove the traffic. This is the data behind the headline
 * "מאיזה קבוצה הגיעו הקליקים" view.
 *
 * Joins:
 *   - parent shortlink → its children (one per post×group)
 *   - children → their groups
 *   - children → their click rows
 */
export async function getPerGroupClicksForParent(
  userId: string,
  parentId: string,
): Promise<PerGroupClickRow[]> {
  // Verify ownership upfront — countConsecutiveFailures-style.
  const parent = await getParentShortlinkForUser(userId, parentId);
  if (!parent) return [];

  // Children grouped by group_id, with click counts.
  const rows = await db
    .select({
      groupId: shortlinks.groupId,
      groupName: groups.name,
      groupUrl: groups.url,
      childSlug: shortlinks.slug,
      postsCount: count(sql`DISTINCT ${shortlinks.id}`).as('posts_count'),
      totalClicks: sql<number>`COALESCE(SUM(CASE WHEN ${shortlinkClicks.isBot} = false THEN 1 ELSE 0 END), 0)`.as('total_clicks'),
      uniqueClickers: sql<number>`COUNT(DISTINCT CASE WHEN ${shortlinkClicks.isBot} = false THEN ${shortlinkClicks.ipHash} END)`.as('unique_clickers'),
      botClicks: sql<number>`COALESCE(SUM(CASE WHEN ${shortlinkClicks.isBot} = true THEN 1 ELSE 0 END), 0)`.as('bot_clicks'),
    })
    .from(shortlinks)
    .leftJoin(groups, eq(groups.id, shortlinks.groupId))
    .leftJoin(shortlinkClicks, eq(shortlinkClicks.shortlinkId, shortlinks.id))
    .where(eq(shortlinks.parentId, parentId))
    .groupBy(shortlinks.groupId, groups.name, groups.url, shortlinks.slug)
    .orderBy(desc(sql`total_clicks`));

  return rows.map((r) => ({
    groupId: r.groupId,
    groupName: r.groupName,
    groupUrl: r.groupUrl,
    childSlug: r.childSlug,
    postsCount: Number(r.postsCount),
    totalClicks: Number(r.totalClicks),
    uniqueClickers: Number(r.uniqueClickers),
    botClicks: Number(r.botClicks),
  }));
}

/**
 * Aggregated stats for the parent: total clicks across the parent and
 * all its children (so a parent that's also been pasted manually outside
 * of campaigns counts too).
 */
export interface ParentTotals {
  totalClicks: number;
  uniqueClickers: number;
  botClicks: number;
  childrenCount: number;
  groupsReached: number;
}

export async function getParentTotals(
  userId: string,
  parentId: string,
): Promise<ParentTotals> {
  const parent = await getParentShortlinkForUser(userId, parentId);
  if (!parent) {
    return { totalClicks: 0, uniqueClickers: 0, botClicks: 0, childrenCount: 0, groupsReached: 0 };
  }

  const [agg] = await db
    .select({
      totalClicks: sql<number>`COALESCE(SUM(CASE WHEN ${shortlinkClicks.isBot} = false THEN 1 ELSE 0 END), 0)`.as('total_clicks'),
      uniqueClickers: sql<number>`COUNT(DISTINCT CASE WHEN ${shortlinkClicks.isBot} = false THEN ${shortlinkClicks.ipHash} END)`.as('unique_clickers'),
      botClicks: sql<number>`COALESCE(SUM(CASE WHEN ${shortlinkClicks.isBot} = true THEN 1 ELSE 0 END), 0)`.as('bot_clicks'),
    })
    .from(shortlinks)
    .leftJoin(shortlinkClicks, eq(shortlinkClicks.shortlinkId, shortlinks.id))
    .where(
      sql`${shortlinks.id} = ${parentId} OR ${shortlinks.parentId} = ${parentId}`,
    );

  const childRows = await db
    .select({
      groupId: shortlinks.groupId,
    })
    .from(shortlinks)
    .where(eq(shortlinks.parentId, parentId));

  const distinctGroups = new Set(childRows.map((r) => r.groupId).filter(Boolean));
  return {
    totalClicks: Number(agg?.totalClicks ?? 0),
    uniqueClickers: Number(agg?.uniqueClickers ?? 0),
    botClicks: Number(agg?.botClicks ?? 0),
    childrenCount: childRows.length,
    groupsReached: distinctGroups.size,
  };
}

/**
 * Recent clicks across the parent + children, for the timeline / list
 * view in the drilldown page.
 */
export async function getRecentClicksForParent(
  userId: string,
  parentId: string,
  limit = 50,
): Promise<
  Array<{
    clickedAt: Date;
    isBot: boolean;
    deviceType: string | null;
    country: string | null;
    referrer: string | null;
    groupName: string | null;
  }>
> {
  const parent = await getParentShortlinkForUser(userId, parentId);
  if (!parent) return [];

  const rows = await db
    .select({
      clickedAt: shortlinkClicks.clickedAt,
      isBot: shortlinkClicks.isBot,
      deviceType: shortlinkClicks.deviceType,
      country: shortlinkClicks.country,
      referrer: shortlinkClicks.referrer,
      groupName: groups.name,
    })
    .from(shortlinkClicks)
    .innerJoin(shortlinks, eq(shortlinks.id, shortlinkClicks.shortlinkId))
    .leftJoin(groups, eq(groups.id, shortlinks.groupId))
    .where(
      sql`${shortlinks.id} = ${parentId} OR ${shortlinks.parentId} = ${parentId}`,
    )
    .orderBy(desc(shortlinkClicks.clickedAt))
    .limit(limit);

  return rows;
}

/* ------------------------------------------------------------------ */
/* Phase B — campaign expansion                                        */
/* ------------------------------------------------------------------ */

/**
 * Given a post text and a list of group_ids, ensure a child shortlink
 * exists for every (parent_in_text × group) pair. Returns a map:
 *   { groupId: { 'https://wzp.../l/<parent_slug>': 'https://wzp.../l/<child_slug>' } }
 * which the worker uses to text-replace before posting.
 *
 * Idempotent: existing children are reused; missing ones are inserted.
 * Children that point to inactive parents are skipped (caller should
 * either keep the parent active or remove it from the post text first).
 */
export async function ensureChildShortlinksForGroups(
  userId: string,
  postId: string,
  postText: string,
  groupIds: string[],
): Promise<Record<string, Record<string, string>>> {
  if (groupIds.length === 0 || !postText) return {};
  const { findShortlinkSlugs, shortlinkUrl } = await import('@/lib/shortlinks/urls');
  const parentSlugs = findShortlinkSlugs(postText);
  if (parentSlugs.length === 0) return {};

  // Find parent rows owned by this user that are still active.
  // Drizzle+postgres-js serializes JS arrays oddly with `ANY(${arr})`
  // (it ends up sending a single string instead of a PG array, hence
  // the historical "malformed array literal" silent failure that
  // blocked all per-group attribution). Use drizzle's `inArray` which
  // emits a real `IN (...)` clause and round-trips arrays correctly.
  const parents = await db
    .select()
    .from(shortlinks)
    .where(
      and(
        eq(shortlinks.userId, userId),
        eq(shortlinks.isActive, true),
        inArray(shortlinks.slug, parentSlugs),
        isNull(shortlinks.parentId),
      ),
    );
  if (parents.length === 0) return {};

  // Look up existing children for these parents × groups.
  const existing = await db
    .select()
    .from(shortlinks)
    .where(
      and(
        inArray(shortlinks.parentId, parents.map((p) => p.id)),
        inArray(shortlinks.groupId, groupIds),
      ),
    );

  const existingKey = (parentId: string, groupId: string) => `${parentId}::${groupId}`;
  const have = new Map<string, typeof existing[number]>();
  for (const row of existing) {
    if (row.parentId && row.groupId) {
      have.set(existingKey(row.parentId, row.groupId), row);
    }
  }

  // Insert missing.
  const toInsert: Array<{
    userId: string;
    parentId: string;
    postId: string;
    groupId: string;
    targetUrl: string;
    slug: string;
  }> = [];
  for (const parent of parents) {
    for (const groupId of groupIds) {
      if (have.has(existingKey(parent.id, groupId))) continue;
      toInsert.push({
        userId,
        parentId: parent.id,
        postId,
        groupId,
        targetUrl: parent.targetUrl,
        slug: autoSlug(),
      });
    }
  }

  // Bulk insert with collision retry per row.
  const inserted: typeof existing = [];
  for (const row of toInsert) {
    let attempts = 0;
    while (attempts < 5) {
      try {
        const [inserted_row] = await db
          .insert(shortlinks)
          .values(row)
          .returning();
        if (inserted_row) inserted.push(inserted_row);
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/duplicate key|unique/i.test(msg)) throw err;
        row.slug = autoSlug();
        attempts += 1;
      }
    }
  }

  // Build the worker-facing map.
  const result: Record<string, Record<string, string>> = {};
  const allChildren = [...have.values(), ...inserted];
  for (const child of allChildren) {
    if (!child.parentId || !child.groupId) continue;
    const parent = parents.find((p) => p.id === child.parentId);
    if (!parent) continue;
    const parentUrl = shortlinkUrl(parent.slug);
    const childUrl = shortlinkUrl(child.slug);
    if (!result[child.groupId]) result[child.groupId] = {};
    result[child.groupId]![parentUrl] = childUrl;
  }
  return result;
}
