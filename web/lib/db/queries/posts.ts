import { and, desc, eq } from 'drizzle-orm';
import { db } from '../index';
import { posts, type Post } from '../schema';

export async function listPostsForUser(userId: string): Promise<Post[]> {
  return db
    .select()
    .from(posts)
    .where(eq(posts.userId, userId))
    .orderBy(desc(posts.createdAt));
}

/**
 * Returns the post only if it belongs to the given user. Ownership-checked.
 */
export async function getPost(id: string, userId: string): Promise<Post | null> {
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function createPost(input: {
  userId: string;
  text: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
}): Promise<Post> {
  const [row] = await db
    .insert(posts)
    .values({
      userId: input.userId,
      text: input.text,
      imageUrl: input.imageUrl ?? null,
      videoUrl: input.videoUrl ?? null,
    })
    .returning();
  if (!row) throw new Error('Failed to create post');
  return row;
}

export async function deletePost(id: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, userId)))
    .returning({ id: posts.id });
  return rows.length > 0;
}

/* ------------------------------------------------------------------ */
/* Aliases — *ForUser naming used by the API layer.                   */
/* These flip the (id, userId) order to (userId, id) so callers can   */
/* read top-down: "thing FOR user X with id Y".                       */
/* ------------------------------------------------------------------ */

export const getPostForUser = (userId: string, id: string) => getPost(id, userId);
export const deletePostForUser = (userId: string, id: string) => deletePost(id, userId);
export const createPostForUser = (
  userId: string,
  input: { text: string; imageUrl?: string | null; videoUrl?: string | null },
) => createPost({ userId, ...input });
