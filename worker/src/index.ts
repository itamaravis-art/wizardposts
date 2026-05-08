// Worker entry point. Reads env, validates the worker token via /heartbeat,
// then starts the polling loop. SIGINT/SIGTERM trigger graceful shutdown.

import 'dotenv/config'; // optional: lets npm run dev pick up .env automatically
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './utils/logger.js';
import { heartbeat, WorkerHttpError } from './api-client.js';
import { startMainLoop, requestStop } from './main-loop.js';
import { startScheduler, requestStopScheduler } from './scheduled-tasks.js';

/**
 * Singleton lock — refuse to start a second worker against the same
 * Chromium user-data-dir. Two workers fighting over `data/session`
 * each spawn a Chromium that fails to lock the dir, the next launch
 * crashes, and the error loop opens dozens of orphan about:blank tabs.
 * The lock here makes that impossible.
 */
function acquireSingletonLock(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Lock lives INSIDE the worker dir (worker/.worker.lock), not the
  // parent. On the home install at `C:\wizardposts-worker\`, going up
  // two levels lands at `C:\` which is UAC-protected → EPERM crash.
  // One level up from `src/` = the worker root, always writable.
  const lockPath = path.resolve(here, '..', '.worker.lock');
  if (fs.existsSync(lockPath)) {
    try {
      const otherPid = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
      if (Number.isFinite(otherPid) && otherPid > 0) {
        try {
          // process.kill(pid, 0) throws if PID is dead, no-op if alive.
          process.kill(otherPid, 0);
          // eslint-disable-next-line no-console
          console.error(
            `Another worker (PID ${otherPid}) is already running — refusing to start. ` +
              `Stop it first, or delete ${lockPath} if you're sure it's stale.`,
          );
          process.exit(3);
        } catch {
          logger.info({ stalePid: otherPid }, 'startup: removing stale worker lock');
        }
      }
    } catch {
      /* unreadable lock — overwrite */
    }
  }
  fs.writeFileSync(lockPath, String(process.pid));
  const release = () => {
    try {
      const pidIn = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
      if (pidIn === process.pid) fs.unlinkSync(lockPath);
    } catch {
      /* best-effort */
    }
  };
  process.on('exit', release);
}

function ensureEnv(): void {
  const missing: string[] = [];
  if (!process.env.WORKER_TOKEN) missing.push('WORKER_TOKEN');
  if (!process.env.API_BASE_URL) missing.push('API_BASE_URL');
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(
      `Missing required env vars: ${missing.join(', ')}. ` +
        `Copy .env.example to .env and fill them in.`,
    );
    process.exit(1);
  }
}

async function validateToken(): Promise<void> {
  const workerName = process.env.WORKER_NAME || os.hostname();
  try {
    const hb = await heartbeat({ workerName });
    logger.info(
      {
        userId: hb.userId,
        fbConnected: hb.fbConnected,
        workerName,
      },
      'startup: token validated',
    );
  } catch (err) {
    if (err instanceof WorkerHttpError && (err.status === 401 || err.status === 403)) {
      logger.error(
        { status: err.status, body: err.body },
        'startup: WORKER_TOKEN is invalid or revoked. Generate a new one at /dashboard/worker.',
      );
      process.exit(2);
    }
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'startup: heartbeat failed (network or server). Will start the loop and retry.',
    );
    // Don't exit on transient errors — operator's network may be flaky.
  }
}

async function main(): Promise<void> {
  ensureEnv();
  acquireSingletonLock();
  logger.info('worker: starting');

  await validateToken();

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'worker: shutdown signal received');
    requestStop();
    requestStopScheduler();
    // Give the loop ~10s to finish the current iteration; force-exit otherwise.
    setTimeout(() => {
      logger.warn('worker: forced exit after grace period');
      process.exit(0);
    }, 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Run the cron scheduler alongside the main posting loop. The
  // scheduler pings `/api/cron/*` endpoints itself so we don't depend
  // on Vercel Hobby's flaky cron service. Returning promise is fired
  // and forgotten on purpose — main-loop is the foreground task.
  void startScheduler();

  await startMainLoop();
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'worker: fatal error');
  process.exit(1);
});
