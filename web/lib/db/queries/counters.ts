/**
 * Per-user, per-day counters used to enforce daily caps.
 *
 * "Today" is computed in UTC; if you need user-local days, push timezone
 * conversion to the caller before passing the date in.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../index';
import { dailyCounters, type DailyCounter } from '../schema';

function todayISODate(): string {
  // YYYY-MM-DD in UTC.
  return new Date().toISOString().slice(0, 10);
}

export async function getTodayCount(userId: string): Promise<number> {
  const day = todayISODate();
  const [row] = await db
    .select()
    .from(dailyCounters)
    .where(and(eq(dailyCounters.userId, userId), eq(dailyCounters.day, day)))
    .limit(1);
  return row?.postedCount ?? 0;
}

/**
 * Atomically increment today's counter, creating the row if it doesn't exist.
 * Returns the new count.
 */
export async function incrementTodayCount(userId: string): Promise<number> {
  const day = todayISODate();
  const [row] = await db
    .insert(dailyCounters)
    .values({ userId, day, postedCount: 1 })
    .onConflictDoUpdate({
      target: [dailyCounters.userId, dailyCounters.day],
      set: { postedCount: sql`${dailyCounters.postedCount} + 1` },
    })
    .returning();
  if (!row) throw new Error('Failed to increment daily counter');
  return (row as DailyCounter).postedCount;
}
