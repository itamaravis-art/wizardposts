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
  /**
   * When true, after firing we check the JSON response for
   * `totalGenerated === 0`. If so, the daily task is considered
   * "fired but did nothing" — we reset `lastRunDateUtc` so the loop
   * retries on the next tick (capped by `retriesToday`). This catches
   * transient OpenAI / network failures that returned 200 OK with an
   * empty result, which happened once in production and silently lost
   * a daily post.
   */
  retryOnEmptyResult?: boolean;
  /** Retries used today — reset when lastRunDateUtc advances. */
  retriesToday?: number;
  /** Earliest UTC ms to retry. Spaces out retries by ~10 min. */
  nextRetryAt?: number;
}

const MAX_RETRIES_PER_DAY = 5;
const RETRY_DELAY_MS = 10 * 60 * 1000;

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
  // retryOnEmptyResult: on 5/11 production we lost a daily post because
  // the cron returned 200 OK with totalGenerated=0 silently. Retry up
  // to 5×10min so a one-shot OpenAI hiccup doesn't kill a slot.
  { name: 'generate@10:00', path: '/api/cron/generate?slot=10:00', utcHour: 19, utcMinute: 0,  retryOnEmptyResult: true },
  { name: 'generate@18:00', path: '/api/cron/generate?slot=18:00', utcHour: 19, utcMinute: 15, retryOnEmptyResult: true },
  // 09:30 IL = 06:30 UTC.
  { name: 'skip-stale',    path: '/api/cron/skip-stale',    utcHour: 6,  utcMinute: 30 },
  // 07:00 IL = 04:00 UTC.
  { name: 'notify-pending',path: '/api/cron/notify-pending',utcHour: 4,  utcMinute: 0 },
  // 03:00 IL = 00:00 UTC (good window — quiet hours).
  { name: 'refresh-tokens',path: '/api/cron/refresh-tokens',utcHour: 0,  utcMinute: 0 },
  // 23:00 IL = 20:00 UTC — runs AFTER the generate slots, sends a
  // WhatsApp alert if we ended the day with <2 posts queued for
  // tomorrow. Server-side endpoint added in this commit.
  { name: 'check-generation',path: '/api/cron/check-generation', utcHour: 20, utcMinute: 0 },
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

/** Result of a cron call: includes the parsed JSON body so callers can
 *  decide whether to retry (e.g. on totalGenerated=0). */
interface CronCallResult {
  ok: boolean;
  body?: unknown;
}

async function fireCron(
  path: string,
  baseUrl: string,
  secret: string,
): Promise<CronCallResult> {
  const url = baseUrl.replace(/\/$/, '') + path;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(75_000),
    });
    const elapsedMs = Date.now() - start;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn(
        { path, status: res.status, body: body.slice(0, 200), elapsedMs },
        'scheduler: cron call returned non-OK',
      );
      return { ok: false };
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* not all crons return JSON */
    }
    logger.info({ path, elapsedMs }, 'scheduler: cron call succeeded');
    return { ok: true, body };
  } catch (err) {
    logger.warn(
      { path, err: err instanceof Error ? err.message : String(err) },
      'scheduler: cron call threw',
    );
    return { ok: false };
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
    // already fired today. retryOnEmptyResult tasks (generate) re-fire
    // up to MAX_RETRIES_PER_DAY × RETRY_DELAY_MS apart when the cloud
    // returns 200 OK but totalGenerated=0.
    for (const task of DAILY_TASKS) {
      // Reset retry counter at the start of each UTC day.
      if (task.lastRunDateUtc !== todayKey) {
        task.retriesToday = 0;
        task.nextRetryAt = undefined;
      }
      // Skip if we already had a successful fire today (lastRunDateUtc
      // set to today *and* not in retry mode).
      const inRetryMode = task.retryOnEmptyResult && (task.retriesToday ?? 0) > 0;
      if (task.lastRunDateUtc === todayKey && !inRetryMode) continue;

      const targetMinutes = task.utcHour * 60 + task.utcMinute;
      const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      const inFireWindow = nowMinutes >= targetMinutes && nowMinutes <= targetMinutes + 30;
      const retryDue = inRetryMode && task.nextRetryAt && now.getTime() >= task.nextRetryAt;

      if (inFireWindow || retryDue) {
        logger.info(
          { task: task.name, retry: task.retriesToday ?? 0 },
          'scheduler: firing daily task',
        );
        const result = await fireCron(task.path, apiBase, cronSecret);
        task.lastRunDateUtc = todayKey;

        // Inspect for "fired but did nothing" only on retry-eligible tasks.
        if (
          task.retryOnEmptyResult &&
          result.ok &&
          result.body &&
          typeof result.body === 'object' &&
          'totalGenerated' in result.body &&
          (result.body as { totalGenerated: number }).totalGenerated === 0 &&
          (task.retriesToday ?? 0) < MAX_RETRIES_PER_DAY
        ) {
          task.retriesToday = (task.retriesToday ?? 0) + 1;
          task.nextRetryAt = now.getTime() + RETRY_DELAY_MS;
          logger.warn(
            { task: task.name, retry: task.retriesToday, nextInMs: RETRY_DELAY_MS },
            'scheduler: generate returned totalGenerated=0 — will retry',
          );
        } else if (task.retryOnEmptyResult && result.ok && (task.retriesToday ?? 0) > 0) {
          // Success on a retry — clear the retry budget so we don't
          // re-enter the loop.
          logger.info(
            { task: task.name, retryUsed: task.retriesToday },
            'scheduler: retry succeeded',
          );
          task.retriesToday = 0;
          task.nextRetryAt = undefined;
        }
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
