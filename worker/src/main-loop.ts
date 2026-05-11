// The polling loop: ask cloud for work, do work, report results.

import os from 'node:os';
import type { BrowserContext } from 'playwright';
import {
  heartbeat,
  getNextJob,
  reportResult,
  setConnectionStatus,
  uploadScreenshot,
  getNextRecheck,
  reportRecheck,
  WorkerHttpError,
  type WorkerSettings,
  type JobPayload,
} from './api-client.js';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from './utils/logger.js';
import { SCREENSHOTS_DIR } from './utils/paths.js';
import { downloadImageToTemp, safeUnlink } from './utils/download.js';
import { launchBrowser, closeBrowser as closeLauncher } from './browser/launcher.js';
import { getOrCreatePage, isLoggedIn, getLoggedInUserName } from './browser/session.js';
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
  // Bug #9 iter7 — overlay intercepts submit click. Sometimes the
  // overlay clears within minutes (FB notification banner auto-dismiss).
  // 10 min keeps it transient without hammering FB.
  submit_blocked: 600_000,
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

    // We just verified the worker is logged in. Make sure the cloud DB
    // reflects that — the dashboard "Connected / Not connected" banner
    // reads `users.fb_connected`, and that flag could have been flipped
    // to false on a previous transient mis-detection. Setting it on
    // every confirmed-login is cheap (~tens of ms) and keeps the UI
    // honest. Best-effort — don't fail the job if the call hiccups.
    {
      const userName = await getLoggedInUserName(page).catch(() => null);
      await setConnectionStatus({
        connected: true,
        ...(userName ? { userName } : {}),
      }).catch((err) =>
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'main-loop: failed to mark fb_connected=true',
        ),
      );
    }

    // Prefer image if both are present (image is faster to upload); fall
    // back to video. FB's composer accepts either through the same Photo/
    // Video file input.
    const mediaUrl = post.image_url ?? post.video_url ?? null;
    if (mediaUrl) {
      try {
        imagePath = await downloadImageToTemp(mediaUrl);
      } catch (err) {
        logger.error({ err, jobId: job.id }, 'main-loop: media download failed');
        await reportResult(job.id, {
          success: false,
          message: `Media download failed: ${err instanceof Error ? err.message : String(err)}`,
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
      // Tell the poster what we're attaching so it can wait longer for
      // video uploads (Playwright's image-preview wait is 30s, fine for
      // images, marginal for short clips).
      mediaKind: post.image_url ? 'image' : post.video_url ? 'video' : null,
      spinVariations: campaign?.text_variations ?? false,
      typingMinMs: settings.typing_min_ms,
      typingMaxMs: settings.typing_max_ms,
      screenshotDir: SCREENSHOTS_DIR,
      jobId: job.id,
      shortlinks: jobPayload.shortlinks ?? {},
    });

    // Iter6 — verbose tracing on the screenshot upload pipeline because
    // bug #8 manifested as silent disappearance: subsequent jobs after
    // the first showed neither "saved" nor "upload failed" in the log.
    // We now log every branch: have-path / no-path / upload-ok / upload-fail.
    let screenshotUrl: string | undefined;
    if (result.screenshotPath) {
      logger.info(
        { jobId: job.id, screenshotPath: result.screenshotPath, success: result.success },
        'main-loop: uploading screenshot',
      );
      try {
        const uploaded = await uploadScreenshot(result.screenshotPath);
        screenshotUrl = uploaded.url;
        logger.info(
          { jobId: job.id, screenshotUrl: uploaded.url },
          'main-loop: screenshot uploaded',
        );
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), jobId: job.id },
          'main-loop: screenshot upload failed, reporting without URL',
        );
      }
    } else {
      logger.info(
        { jobId: job.id, success: result.success },
        'main-loop: no screenshotPath on result — skipping upload',
      );
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

/**
 * Take a single fresh screenshot of a previously-pending group so the
 * cloud GPT-4o classifier can decide whether the admin has approved
 * the post. Best-effort — failures are logged and swallowed so they
 * don't disrupt the regular posting loop.
 */
async function tryOneRecheck(): Promise<void> {
  let task;
  try {
    task = await getNextRecheck();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'recheck: getNextRecheck failed; skipping',
    );
    return;
  }
  if (!task) return;

  logger.info(
    { jobId: task.jobId, groupUrl: task.groupUrl, lastRecheckedAt: task.lastRecheckedAt },
    'recheck: visiting group to verify admin approval',
  );

  let browserCtx: BrowserContext;
  try {
    browserCtx = await ensureBrowser();
  } catch (err) {
    logger.warn({ err }, 'recheck: failed to launch browser; skipping');
    return;
  }

  try {
    const page = await getOrCreatePage(browserCtx);
    if (!(await isLoggedIn(page))) {
      logger.info({ jobId: task.jobId }, 'recheck: not logged in to FB, skipping');
      return;
    }

    await page.goto(task.groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    // Give the feed a beat to mount and scroll a bit so the latest
    // posts are in viewport.
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollTo(0, 600)).catch(() => {});
    await page.waitForTimeout(1500);

    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const file = path.join(SCREENSHOTS_DIR, `recheck-${task.jobId}-${Date.now()}.png`);
    let buf: Buffer;
    try {
      buf = await page.screenshot({ fullPage: false, timeout: 8000 });
    } catch (err) {
      logger.warn({ err, jobId: task.jobId }, 'recheck: screenshot threw');
      return;
    }
    if (!buf || buf.length === 0) {
      logger.warn({ jobId: task.jobId }, 'recheck: empty screenshot buffer');
      return;
    }
    await fs.promises.writeFile(file, buf);
    logger.info(
      { jobId: task.jobId, file, sizeBytes: buf.length },
      'recheck: screenshot captured, uploading',
    );

    let screenshotUrl: string | null = null;
    try {
      const uploaded = await uploadScreenshot(file);
      screenshotUrl = uploaded.url;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), jobId: task.jobId },
        'recheck: upload failed',
      );
      return;
    } finally {
      safeUnlink(file);
    }
    if (!screenshotUrl) return;

    try {
      await reportRecheck(task.jobId, screenshotUrl);
      logger.info({ jobId: task.jobId, screenshotUrl }, 'recheck: cloud classifier invoked');
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), jobId: task.jobId },
        'recheck: report-recheck call failed',
      );
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), jobId: task.jobId },
      'recheck: unexpected error',
    );
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
        // No regular post pending — try a recheck of a previously
        // pending-moderator-approval job. One per cycle keeps load
        // off Facebook and gives admins time between visits.
        await tryOneRecheck();
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
