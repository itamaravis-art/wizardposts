// The polling loop: ask cloud for work, do work, report results.

import os from 'node:os';
import type { BrowserContext } from 'playwright';
import {
  heartbeat,
  getNextJob,
  reportResult,
  setConnectionStatus,
  uploadScreenshot,
  WorkerHttpError,
  type WorkerSettings,
  type JobPayload,
} from './api-client.js';
import { logger } from './utils/logger.js';
import { SCREENSHOTS_DIR } from './utils/paths.js';
import { downloadImageToTemp, safeUnlink } from './utils/download.js';
import { launchBrowser, closeBrowser as closeLauncher } from './browser/launcher.js';
import { getOrCreatePage, isLoggedIn } from './browser/session.js';
import { postToGroup, type FailureKind } from './poster/poster.js';

const POLL_INTERVAL_MS = 8000;
const PAUSE_AFTER_NO_LOGIN_MS = 60_000;

/**
 * Per-failure-kind cooldown after a job fails. Replaces the user's
 * min/max delay (which still governs the post-success spacing). Why:
 *   - composer_not_found: wait 10 min — DOM drift; usually self-heals
 *     once we deploy a selector update; no point hammering FB until then.
 *   - composer_no_textbox: 8 min — same idea, slightly faster retry.
 *   - login_required: 0 ms — the heartbeat will mark fb disconnected
 *     and the loop already idles until a /connect.
 *   - group_no_permission: 5 s — skip and try the next group fast.
 *   - fb_blocked: 1 hour — captcha/checkpoint needs a long cooldown.
 *   - network_error: 30 s — retry quickly, probably a transient flake.
 *   - submit_failed / image_missing: 5 min — could be local issue.
 *   - unknown: 5 min — default safe value.
 */
const COOLDOWN_BY_KIND: Record<FailureKind, number> = {
  composer_not_found: 600_000,
  composer_no_textbox: 480_000,
  login_required: 0,
  group_no_permission: 5_000,
  fb_blocked: 3_600_000,
  network_error: 30_000,
  submit_failed: 300_000,
  image_missing: 300_000,
  unknown: 300_000,
};

let stopRequested = false;
let ctx: BrowserContext | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withinWorkHours(settings: WorkerSettings, now = new Date()): boolean {
  const hour = now.getHours();
  const start = settings.work_hours_start ?? 0;
  const end = settings.work_hours_end ?? 24;
  if (start === end) return true; // sentinel for "always"
  if (start < end) return hour >= start && hour < end;
  // overnight window (e.g. 22 -> 6): allowed when >= start OR < end
  return hour >= start || hour < end;
}

async function ensureBrowser(): Promise<BrowserContext> {
  if (ctx) return ctx;
  logger.info('main-loop: launching browser context (lazy)');
  ctx = await launchBrowser();
  ctx.on('close', () => {
    logger.warn('main-loop: browser context closed externally');
    ctx = null;
  });
  return ctx;
}

/**
 * Result of a single runJob, used by the loop to size the next sleep.
 * `successive` is the worker-loop equivalent of "what to do next" — when
 * the job succeeded we use the user's min/max delay; when it failed we
 * use a per-kind cooldown so a transient DOM-drift issue isn't punished
 * with a one-hour back-off.
 */
type RunOutcome =
  | { ok: true }
  | { ok: false; kind: FailureKind | undefined };

async function runJob(jobPayload: JobPayload, settings: WorkerSettings): Promise<RunOutcome> {
  const { job, campaign, post, group } = jobPayload;
  let imagePath: string | null = null;

  // Reject un-runnable jobs early — a related row was deleted server-side
  // between insert and claim. Reporting failure lets the cloud move on rather
  // than re-queuing forever.
  if (!post || !group) {
    const missing = [!post && 'post', !group && 'group'].filter(Boolean).join(', ');
    logger.warn({ jobId: job.id, missing }, 'main-loop: job has missing related rows, marking failed');
    await reportResult(job.id, {
      success: false,
      message: `Job has missing related rows: ${missing}`,
      failureKind: 'unknown',
    }).catch((err) =>
      logger.error({ err, jobId: job.id }, 'main-loop: failed to report missing-rows failure'),
    );
    return { ok: false, kind: 'unknown' };
  }

  try {
    const browserCtx = await ensureBrowser();
    const page = await getOrCreatePage(browserCtx);

    // Verify login each cycle (cookies could have been invalidated remotely).
    if (!(await isLoggedIn(page))) {
      logger.warn({ jobId: job.id }, 'main-loop: not logged in to Facebook, marking disconnected');
      await setConnectionStatus({ connected: false }).catch((err) =>
        logger.error({ err }, 'main-loop: failed to update connection status'),
      );
      await reportResult(job.id, {
        success: false,
        message: 'Worker not logged in to Facebook (cookies missing/expired)',
        blockerKind: 'login-required',
        failureKind: 'login_required',
      }).catch((err) => logger.error({ err }, 'main-loop: failed to report login-required'));
      await sleep(PAUSE_AFTER_NO_LOGIN_MS);
      return { ok: false, kind: 'login_required' };
    }

    if (post.image_url) {
      try {
        imagePath = await downloadImageToTemp(post.image_url);
      } catch (err) {
        logger.error({ err, jobId: job.id }, 'main-loop: image download failed');
        await reportResult(job.id, {
          success: false,
          message: `Image download failed: ${err instanceof Error ? err.message : String(err)}`,
          failureKind: 'network_error',
        });
        return { ok: false, kind: 'network_error' };
      }
    }

    const result = await postToGroup({
      ctx: browserCtx,
      groupUrl: group.url,
      text: post.text,
      imagePath,
      spinVariations: campaign?.text_variations ?? false,
      typingMinMs: settings.typing_min_ms,
      typingMaxMs: settings.typing_max_ms,
      screenshotDir: SCREENSHOTS_DIR,
      jobId: job.id,
    });

    let screenshotUrl: string | undefined;
    if (result.screenshotPath) {
      try {
        const uploaded = await uploadScreenshot(result.screenshotPath);
        screenshotUrl = uploaded.url;
      } catch (err) {
        logger.warn(
          { err, jobId: job.id },
          'main-loop: screenshot upload failed, reporting without URL',
        );
      }
    }

    await reportResult(job.id, {
      success: result.success,
      message: result.message,
      ...(screenshotUrl !== undefined ? { screenshotUrl } : {}),
      ...(result.blocker !== undefined ? { blockerKind: result.blocker } : {}),
      ...(result.kind !== undefined ? { failureKind: result.kind } : {}),
    });

    return result.success ? { ok: true } : { ok: false, kind: result.kind };
  } finally {
    safeUnlink(imagePath);
  }
}

export async function startMainLoop(): Promise<void> {
  const workerName = process.env.WORKER_NAME || os.hostname();
  logger.info({ workerName }, 'main-loop: starting');

  while (!stopRequested) {
    const startedAt = Date.now();
    try {
      const hb = await heartbeat({ workerName });

      if (!hb.fbConnected || !hb.settings.fb_connected) {
        logger.info('main-loop: Facebook not connected on this account, idling');
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      if (!withinWorkHours(hb.settings)) {
        logger.debug(
          { start: hb.settings.work_hours_start, end: hb.settings.work_hours_end },
          'main-loop: outside work hours, idling',
        );
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const job = await getNextJob();
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      logger.info(
        {
          jobId: job.job.id,
          campaignId: job.campaign?.id ?? null,
          groupUrl: job.group?.url ?? null,
        },
        'main-loop: processing job',
      );
      const outcome = await runJob(job, hb.settings);

      // Cooldown selection:
      //   - On success: random delay between user's min/max (legitimate
      //     spacing to look human).
      //   - On failure: per-failure-kind cooldown (transient kinds get
      //     short retries; permanent kinds get long back-offs).
      let wait: number;
      if (outcome.ok) {
        const minD = Math.max(0, hb.settings.min_delay_ms);
        const maxD = Math.max(minD, hb.settings.max_delay_ms);
        wait = minD + Math.floor(Math.random() * (maxD - minD + 1));
        logger.info({ wait, reason: 'success' }, 'main-loop: cooling down before next iteration');
      } else {
        const kind = outcome.kind ?? 'unknown';
        wait = COOLDOWN_BY_KIND[kind] ?? COOLDOWN_BY_KIND.unknown;
        logger.info(
          { wait, reason: 'failure', failureKind: kind },
          'main-loop: cooling down before next iteration (failure-kind based)',
        );
      }
      await sleep(wait);
    } catch (err) {
      // Crash-proof outer try: never let the loop die on a transient error.
      if (err instanceof WorkerHttpError) {
        if (err.status === 401 || err.status === 403) {
          logger.error(
            { status: err.status, body: err.body },
            'main-loop: WORKER_TOKEN appears invalid or revoked. ' +
              'Generate a new token at /dashboard/worker, replace it in .env, and restart the worker.',
          );
          // Token is broken — keep looping at a slow cadence so the operator
          // can fix .env without the process dying. Do NOT exit silently.
          await sleep(60_000);
          continue;
        }
      }
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'main-loop: iteration failed, continuing',
      );
      // Backoff a bit so we don't hot-spin on a recurring error.
      const elapsed = Date.now() - startedAt;
      const backoff = Math.max(POLL_INTERVAL_MS - elapsed, 5000);
      await sleep(backoff);
    }
  }

  logger.info('main-loop: shutdown requested, exiting loop');
  if (ctx) {
    await closeLauncher(ctx).catch(() => {});
    ctx = null;
  }
}

export function requestStop(): void {
  stopRequested = true;
}
