// Worker entry point. Reads env, validates the worker token via /heartbeat,
// then starts the polling loop. SIGINT/SIGTERM trigger graceful shutdown.

import 'dotenv/config'; // optional: lets npm run dev pick up .env automatically
import os from 'node:os';
import { logger } from './utils/logger.js';
import { heartbeat, WorkerHttpError } from './api-client.js';
import { startMainLoop, requestStop } from './main-loop.js';

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
  logger.info('worker: starting');

  await validateToken();

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'worker: shutdown signal received');
    requestStop();
    // Give the loop ~10s to finish the current iteration; force-exit otherwise.
    setTimeout(() => {
      logger.warn('worker: forced exit after grace period');
      process.exit(0);
    }, 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await startMainLoop();
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'worker: fatal error');
  process.exit(1);
});
