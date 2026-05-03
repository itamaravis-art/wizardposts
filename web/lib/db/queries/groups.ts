import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../index';
import { groups, type Group } from '../schema';

export interface ListGroupsOpts {
  tag?: string;
  active?: boolean;
  /** Convenience: when true, filter to active groups only. */
  activeOnly?: boolean;
}

export async function listGroupsForUser(
  userId: string,
  opts: ListGroupsOpts = {},
): Promise<Group[]> {
  const conditions = [eq(groups.userId, userId)];
  if (opts.tag !== undefined) conditions.push(eq(groups.tag, opts.tag));
  if (opts.active !== undefined) conditions.push(eq(groups.active, opts.active));
  if (opts.activeOnly === true) conditions.push(eq(groups.active, true));

  return db
    .select()
    .from(groups)
    .where(and(...conditions))
    .orderBy(desc(groups.createdAt));
}

export async function createGroup(input: {
  userId: string;
  url: string;
  name?: string | null;
  tag?: string | null;
}): Promise<Group> {
  const [row] = await db
    .insert(groups)
    .values({
      userId: input.userId,
      url: input.url,
      name: input.name ?? null,
      tag: input.tag ?? null,
    })
    .returning();
  if (!row) throw new Error('Failed to create group');
  return row;
}

/**
 * Bulk-insert groups for a user. Conflicts on (user_id, url) are ignored, so
 * repeated calls with the same URL set are idempotent.
 *
 * Returns only the rows that were actually inserted.
 */
export async function bulkCreateGroups(
  userId: string,
  urls: string[],
  tag?: string | null,
): Promise<Group[]> {
  if (urls.length === 0) return [];
  const values = urls.map((url) => ({
    userId,
    url,
    tag: tag ?? null,
  }));
  return db
    .insert(groups)
    .values(values)
    .onConflictDoNothing({ target: [groups.userId, groups.url] })
    .returning();
}

export async function updateGroup(
  id: string,
  userId: string,
  partial: Partial<Pick<Group, 'name' | 'tag' | 'active'>>,
): Promise<Group | null> {
  const [row] = await db
    .update(groups)
    .set(partial)
    .where(and(eq(groups.id, id), eq(groups.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteGroup(id: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(groups)
    .where(and(eq(groups.id, id), eq(groups.userId, userId)))
    .returning({ id: groups.id });
  return rows.length > 0;
}

export async function incrementGroupSuccess(id: string): Promise<void> {
  await db
    .update(groups)
    .set({
      successCount: sql`${groups.successCount} + 1`,
      lastPostedAt: new Date(),
    })
    .where(eq(groups.id, id));
}

export async function incrementGroupFail(id: string): Promise<void> {
  await db
    .update(groups)
    .set({ failCount: sql`${groups.failCount} + 1` })
    .where(eq(groups.id, id));
}

/* ------------------------------------------------------------------ */
/* Aliases — *ForUser naming used by the API layer.                   */
/* ------------------------------------------------------------------ */

export const createGroupForUser = (
  userId: string,
  input: { url: string; name?: string | null; tag?: string | null },
) => createGroup({ userId, ...input });

export const updateGroupForUser = (
  userId: string,
  id: string,
  partial: Partial<Pick<Group, 'name' | 'tag' | 'active'>>,
) => updateGroup(id, userId, partial);

export const deleteGroupForUser = (userId: string, id: string) =>
  deleteGroup(id, userId);

/**
 * Bulk-import groups for a user. Each input may have a per-row `tag`.
 * Inserts rows in batches sharing the same tag and reports how many were
 * actually created vs. skipped due to the (user_id, url) unique constraint.
 */
export async function bulkCreateGroupsForUser(
  userId: string,
  inputs: { url: string; tag?: string | null }[],
): Promise<{ created: number; skipped: number }> {
  if (inputs.length === 0) return { created: 0, skipped: 0 };

  // Group inputs by tag so we can reuse the existing bulkCreateGroups helper.
  const byTag = new Map<string, string[]>();
  for (const it of inputs) {
    const key = it.tag ?? '';
    const arr = byTag.get(key) ?? [];
    arr.push(it.url);
    byTag.set(key, arr);
  }

  let created = 0;
  let totalRequested = 0;
  for (const [tagKey, urls] of byTag) {
    totalRequested += urls.length;
    const tag = tagKey === '' ? null : tagKey;
    const inserted = await bulkCreateGroups(userId, urls, tag);
    created += inserted.length;
  }
  return { created, skipped: totalRequested - created };
}
