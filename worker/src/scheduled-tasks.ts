/**
 * Worker-driven scheduler. Vercel Hobby's cron is unreliable / limited,
 * and pushing GitHub Actions workflows requires `workflow` OAuth scope
 * we don't have. Since the Worker is the most reliable thing we own
 * (running 24/7 on the operator's machine), it pings the cloud's cron
 * endpoints itself.
 *
 * Triggers used:
 *   - publish:        every 5 minutes during 09:00–21:00 IL (06:00–18:00 UTC).
 *   - generate slot 10:00:  daily at 22:00 IL  (19:00 UTC) — preps tomorrow.
 *   - generate slot 18:00:  daily at 22:15 IL  (19:15 UTC) — preps tomorrow.
 *   - skip-stale:     daily at 09:30 IL  (06:30 UTC).
 *   - notify-pending: daily at 07:00 IL  (04:00 UTC).
 *   - refresh-tokens: daily at 03:00 IL  (00:00 UTC).
 *
 * Auth: each call carries `Authorization: Bearer ${CRON_SECRET}`.
 * The Worker reads CRON_SECRET from its .env. If it's missing, the
 * scheduler logs a one-time warning and stays idle (fail-soft).
 */
import { logger } from './utils/logger.js';

interface DailyTask {
  name: string;
  path: string;            // Vercel route to hit
  utcHour: number;         // 0-23
  utcMinute: number;       // 0-59
  lastRunDateUtc?: string; // YYYY-MM-DD — guards against double-fire on the same day
}

interface IntervalTask {
  name: string;
  path: string;
  intervalMs: number;
  utcHourStart?: number;   // optional inclusive window start (UTC)
  utcHourEnd?: number;     // optional inclusive window end (UTC)
  lastRunAt?: number;      // ms since epoch
}

const DAILY_TASKS: DailyTask[] = [
  // Generate runs at 22:00/22:15 IL = 19:00/19:15 UTC during DST. Run a
  // few minutes earlier in case the operator's clock is slightly off.
  { name: 'generate@10:00', path: '/api/cron/generate?slot=10:00', utcHour: 19, utcMinute: 0 },
  { name: 'generate@18:00', path: '/api/cron/generate?slot=18:00', utcHour: 19, utcMinute: 15 },
  // 09:30 IL = 06:30 UTC.
  { name: 'skip-stale',    path: '/api/cron/skip-stale',    utcHour: 6,  utcMinute: 30 },
  // 07:00 IL = 04:00 UTC.
  { name: 'notify-pending',path: '/api/cron/notify-pending',utcHour: 4,  utcMinute: 0 },
  // 03:00 IL = 00:00 UTC (good window — quiet hours).
  { name: 'refresh-tokens',path: '/api/cron/refresh-tokens',utcHour: 0,  utcMinute: 0 },
];

const INTERVAL_TASKS: IntervalTask[] = [
  // Publish every 5 min, but only during the active publishing window
  // (09:00 IL → 21:00 IL, plus a buffer after for late approvals).
  // 06:00 UTC – 19:00 UTC covers slot 10:00 and 18:00 IL with margin.
  {
    name: 'publish',
    path: '/api/cron/publish',
    intervalMs: 5 * 60 * 1000,
    utcHourStart: 6,
    utcHourEnd: 19,
  },
];

let stopRequested = false;
export function requestStopScheduler(): void {
  stopRequested = true;
}

function utcDateKey(d: Date): string {
  // YYYY-MM-DD in UTC
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function inWindow(now: Date, hStart?: number, hEnd?: number): boolean {
  if (hStart === undefined || hEnd === undefined) return true;
  const h = now.getUTCHours();
  if (hStart <= hEnd) return h >= hStart && h <= hEnd;
  // wrap-around (e.g. 22-04). Our windows don't wrap, but support it.
  return h >= hStart || h <= hEnd;
}

async function fireCron(path: string, baseUrl: string, secret: string): Promise<void> {
  const url = baseUrl.replace(/\/$/, '') + path;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
      // Match the cloud's 60s function ceiling.
      signal: AbortSignal.timeout(75_000),
    });
    const elapsedMs = Date.now() - start;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn(
        { path, status: res.status, body: body.slice(0, 200), elapsedMs },
        'scheduler: cron call returned non-OK',
      );
      return;
    }
    logger.info({ path, elapsedMs }, 'scheduler: cron call succeeded');
  } catch (err) {
    logger.warn(
      { path, err: err instanceof Error ? err.message : String(err) },
      'scheduler: cron call threw',
    );
  }
}

export async function startScheduler(): Promise<void> {
  const apiBase = process.env.API_BASE_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!apiBase) {
    logger.warn('scheduler: API_BASE_URL not set — disabled');
    return;
  }
  if (!cronSecret) {
    logger.warn(
      'scheduler: CRON_SECRET not set in worker/.env — daily/publish crons will NOT fire from here.',
    );
    return;
  }

  logger.info(
    {
      daily: DAILY_TASKS.map((t) => `${t.name}@${t.utcHour}:${String(t.utcMinute).padStart(2, '0')}UTC`),
      intervals: INTERVAL_TASKS.map((t) => `${t.name}/${t.intervalMs / 60000}m`),
    },
    'scheduler: starting',
  );

  while (!stopRequested) {
    const now = new Date();
    const todayKey = utcDateKey(now);

    // Daily tasks: fire if we're past the scheduled time and we haven't
    // already fired today.
    for (const task of DAILY_TASKS) {
      if (task.lastRunDateUtc === todayKey) continue;
      const targetMinutes = task.utcHour * 60 + task.utcMinute;
      const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      // 30-minute catch-up window: if we restart at 19:25 UTC and the
      // 19:00 task hasn't fired today, fire it now.
      if (nowMinutes >= targetMinutes && nowMinutes <= targetMinutes + 30) {
        logger.info({ task: task.name }, 'scheduler: firing daily task');
        await fireCron(task.path, apiBase, cronSecret);
        task.lastRunDateUtc = todayKey;
      }
    }

    // Interval tasks: fire if we're inside the window and enough time
    // has elapsed since the last run.
    for (const task of INTERVAL_TASKS) {
      if (!inWindow(now, task.utcHourStart, task.utcHourEnd)) continue;
      const since = task.lastRunAt ? now.getTime() - task.lastRunAt : Infinity;
      if (since >= task.intervalMs) {
        logger.debug({ task: task.name }, 'scheduler: firing interval task');
        await fireCron(task.path, apiBase, cronSecret);
        task.lastRunAt = now.getTime();
      }
    }

    // Tick every 30 seconds — fine-grained enough for the 5-min publish
    // cadence, light enough to be invisible.
    await new Promise((r) => setTimeout(r, 30_000));
  }

  logger.info('scheduler: stopped');
}
