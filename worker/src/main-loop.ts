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
import { postToGroup } from './poster/poster.js';

const POLL_INTERVAL_MS = 8000;
const PAUSE_AFTER_NO_LOGIN_MS = 60_000;

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

async function runJob(jobPayload: JobPayload, settings: WorkerSettings): Promise<void> {
  const { job, campaign, post, group } = jobPayload;
  let imagePath: string | null = null;

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
      }).catch((err) => logger.error({ err }, 'main-loop: failed to report login-required'));
      await sleep(PAUSE_AFTER_NO_LOGIN_MS);
      return;
    }

    if (post.image_url) {
      try {
        imagePath = await downloadImageToTemp(post.image_url);
      } catch (err) {
        logger.error({ err, jobId: job.id }, 'main-loop: image download failed');
        await reportResult(job.id, {
          success: false,
          message: `Image download failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
    }

    const result = await postToGroup({
      ctx: browserCtx,
      groupUrl: group.url,
      text: post.text,
      imagePath,
      spinVariations: campaign.text_variations,
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
    });
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
        { jobId: job.job.id, campaignId: job.campaign.id, groupUrl: job.group.url },
        'main-loop: processing job',
      );
      await runJob(job, hb.settings);

      // Random delay between successful posts (per user settings).
      const minD = Math.max(0, hb.settings.min_delay_ms);
      const maxD = Math.max(minD, hb.settings.max_delay_ms);
      const wait = minD + Math.floor(Math.random() * (maxD - minD + 1));
      logger.info({ wait }, 'main-loop: cooling down before next iteration');
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
