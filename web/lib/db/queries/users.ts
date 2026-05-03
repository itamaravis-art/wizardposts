import { eq } from 'drizzle-orm';
import { db } from '../index';
import { users, type User } from '../schema';

export async function getUserByEmail(email: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row ?? null;
}

export async function getUserById(id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function updateUserFbConnection(
  userId: string,
  data: { fbConnected: boolean; fbUserName?: string | null },
): Promise<User | null> {
  const [row] = await db
    .update(users)
    .set({
      fbConnected: data.fbConnected,
      fbUserName: data.fbUserName ?? null,
    })
    .where(eq(users.id, userId))
    .returning();
  return row ?? null;
}
