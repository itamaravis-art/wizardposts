/**
 * Per-user settings — safety defaults applied to new campaigns and surfaced
 * to the worker via the heartbeat response.
 *
 * There is no separate `settings` table: all values live on the `users` row.
 */
import { eq } from 'drizzle-orm';
import { db } from '../index';
import { users } from '../schema';

/**
 * Shape returned to API callers and the worker. Mirrors the columns added to
 * `users` plus a couple of read-only flags.
 */
export interface UserSettings {
  daily_cap: number;
  min_delay_ms: number;
  max_delay_ms: number;
  work_hours_start: number;
  work_hours_end: number;
  max_consecutive_fails: number;
  typing_min_ms: number;
  typing_max_ms: number;
  fb_connected: boolean;
  fb_user_name: string | null;
}

/** Fields a client can send to PATCH /api/settings — all optional. */
export interface UserSettingsUpdate {
  daily_cap?: number;
  min_delay_ms?: number;
  max_delay_ms?: number;
  work_hours_start?: number;
  work_hours_end?: number;
  max_consecutive_fails?: number;
  typing_min_ms?: number;
  typing_max_ms?: number;
}

/** Sensible defaults. Used when the user row is missing a value (shouldn't
 * happen with NOT NULL DEFAULT columns, but kept as a belt-and-suspenders
 * fallback for older rows in dev databases). */
const DEFAULTS = {
  daily_cap: 12,
  min_delay_ms: 300_000,
  max_delay_ms: 900_000,
  work_hours_start: 9,
  work_hours_end: 22,
  max_consecutive_fails: 3,
  typing_min_ms: 50,
  typing_max_ms: 150,
} as const;

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const [row] = await db
    .select({
      dailyCap: users.dailyCap,
      minDelayMs: users.minDelayMs,
      maxDelayMs: users.maxDelayMs,
      workHoursStart: users.workHoursStart,
      workHoursEnd: users.workHoursEnd,
      maxConsecutiveFails: users.maxConsecutiveFails,
      typingMinMs: users.typingMinMs,
      typingMaxMs: users.typingMaxMs,
      fbConnected: users.fbConnected,
      fbUserName: users.fbUserName,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) {
    return {
      ...DEFAULTS,
      fb_connected: false,
      fb_user_name: null,
    };
  }

  return {
    daily_cap: row.dailyCap ?? DEFAULTS.daily_cap,
    min_delay_ms: row.minDelayMs ?? DEFAULTS.min_delay_ms,
    max_delay_ms: row.maxDelayMs ?? DEFAULTS.max_delay_ms,
    work_hours_start: row.workHoursStart ?? DEFAULTS.work_hours_start,
    work_hours_end: row.workHoursEnd ?? DEFAULTS.work_hours_end,
    max_consecutive_fails:
      row.maxConsecutiveFails ?? DEFAULTS.max_consecutive_fails,
    typing_min_ms: row.typingMinMs ?? DEFAULTS.typing_min_ms,
    typing_max_ms: row.typingMaxMs ?? DEFAULTS.typing_max_ms,
    fb_connected: row.fbConnected,
    fb_user_name: row.fbUserName,
  };
}

export async function updateUserSettings(
  userId: string,
  partial: UserSettingsUpdate,
): Promise<UserSettings> {
  // Map snake_case API shape → camelCase Drizzle columns. Skip undefined so
  // a PATCH that only sends `daily_cap` doesn't blank out the rest.
  const patch: Record<string, number> = {};
  if (partial.daily_cap !== undefined) patch.dailyCap = partial.daily_cap;
  if (partial.min_delay_ms !== undefined)
    patch.minDelayMs = partial.min_delay_ms;
  if (partial.max_delay_ms !== undefined)
    patch.maxDelayMs = partial.max_delay_ms;
  if (partial.work_hours_start !== undefined)
    patch.workHoursStart = partial.work_hours_start;
  if (partial.work_hours_end !== undefined)
    patch.workHoursEnd = partial.work_hours_end;
  if (partial.max_consecutive_fails !== undefined)
    patch.maxConsecutiveFails = partial.max_consecutive_fails;
  if (partial.typing_min_ms !== undefined)
    patch.typingMinMs = partial.typing_min_ms;
  if (partial.typing_max_ms !== undefined)
    patch.typingMaxMs = partial.typing_max_ms;

  if (Object.keys(patch).length > 0) {
    await db.update(users).set(patch).where(eq(users.id, userId));
  }

  return getUserSettings(userId);
}
