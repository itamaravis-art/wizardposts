// Cloud API client. All requests carry the worker bearer token.
//
// 4xx => throw immediately (auth/contract errors should not silently retry).
// 5xx and network failures => retry with exponential backoff (max 3 attempts).
//
// The WORKER_TOKEN is NEVER included in log output.

import fs from 'node:fs';
import path from 'node:path';
import { logger } from './utils/logger.js';
import type { BlockerKind } from './poster/detectors.js';

// ---- Types describing the cloud API surface ----

export interface HeartbeatRequest {
  workerName?: string;
}

export interface WorkerSettings {
  // FB connection state (mirrored on the user row).
  fb_connected: boolean;
  fb_user_name: string | null;
  // Posting cadence
  daily_cap: number;
  min_delay_ms: number;
  max_delay_ms: number;
  typing_min_ms: number;
  typing_max_ms: number;
  // Working hours window (24h, in user's local time on the cloud side)
  work_hours_start: number; // 0-23
  work_hours_end: number;   // 0-24 (exclusive)
  max_consecutive_fails: number;
}

export interface HeartbeatResponse {
  userId: string;
  fbConnected: boolean;
  fbUserName: string | null;
  settings: WorkerSettings;
}

/**
 * Shape returned by GET /api/worker/next-job (200 case).
 * Cloud returns 204 No Content when nothing is pending — that becomes `null`
 * in `getNextJob()` below.
 *
 * `campaign`, `post` and `group` may each be null if their underlying row was
 * deleted between job creation and the worker claiming it (rare but possible).
 * The worker rejects such jobs as un-runnable.
 */
export interface JobPayload {
  job: {
    id: string;
    status: 'pending' | 'running' | 'success' | 'failed';
    attempts: number;
  };
  campaign: {
    id: string;
    name: string;
    min_delay_ms: number;
    max_delay_ms: number;
    text_variations: boolean;
  } | null;
  post: {
    id: string;
    text: string;
    image_url: string | null; // signed URL from Supabase Storage
  } | null;
  group: {
    id: string;
    url: string;
    name: string | null;
  } | null;
  /**
   * Per-group shortlink replacement map: { parent_url: child_url }.
   *
   * The cloud pre-generates child shortlinks for every (post × group)
   * pair where the post text contains one of the user's parent
   * shortlinks. The worker swaps `parent_url` for `child_url` in the
   * post text before typing, which is what gives us per-group click
   * attribution in the dashboard.
   *
   * Empty object when the post has no shortlinks. Missing field on
   * older clouds — treat as empty.
   */
  shortlinks?: Record<string, string>;
}

export interface ReportResultPayload {
  success: boolean;
  message: string;
  screenshotUrl?: string;
  blockerKind?: BlockerKind;
  /**
   * Why a job failed. The cloud uses this to classify the failure as
   * transient (don't count toward campaign auto-pause) vs permanent.
   * Worker-only; older clouds tolerate this extra field gracefully (Zod
   * `.passthrough()` style).
   */
  failureKind?:
    | 'composer_not_found'
    | 'composer_no_textbox'
    | 'login_required'
    | 'group_no_permission'
    | 'fb_blocked'
    | 'network_error'
    | 'image_missing'
    | 'submit_failed'
    | 'submit_blocked'
    | 'unknown';
}

export interface ConnectionStatusPayload {
  connected: boolean;
  userName?: string;
}

export interface UploadScreenshotResponse {
  url: string;
}

// ---- Internal helpers ----

interface WorkerHttpErrorOptions {
  status: number;
  body: string;
  retriable: boolean;
}

export class WorkerHttpError extends Error {
  status: number;
  body: string;
  retriable: boolean;
  constructor(message: string, opts: WorkerHttpErrorOptions) {
    super(message);
    this.name = 'WorkerHttpError';
    this.status = opts.status;
    this.body = opts.body;
    this.retriable = opts.retriable;
  }
}

function getEnvOrThrow(name: 'WORKER_TOKEN' | 'API_BASE_URL'): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set in environment`);
  }
  return v;
}

function authHeaders(): Record<string, string> {
  const token = getEnvOrThrow('WORKER_TOKEN');
  return { Authorization: `Bearer ${token}` };
}

function apiUrl(pathname: string): string {
  const base = getEnvOrThrow('API_BASE_URL').replace(/\/+$/, '');
  const p = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${base}${p}`;
}

async function readBodyAsText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > 2000 ? `${text.slice(0, 2000)}…[truncated]` : text;
  } catch {
    return '<unreadable body>';
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  pathname: string;
  body?: unknown;
  /** Override default 3 attempts. */
  maxAttempts?: number;
}

/**
 * Fetch helper with backoff. Retries on:
 *  - network errors (TypeError from fetch)
 *  - 5xx responses
 * Throws on 4xx without retrying.
 */
async function apiFetch<T>(opts: FetchOptions): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const url = apiUrl(opts.pathname);
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: {
      ...authHeaders(),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) {
        // 204 No Content -> return null cast to T
        if (res.status === 204) return null as T;
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          return (await res.json()) as T;
        }
        const text = await res.text();
        return text as unknown as T;
      }

      const body = await readBodyAsText(res);
      const retriable = res.status >= 500 && res.status <= 599;
      logger.error(
        { method: init.method, pathname: opts.pathname, status: res.status, body, attempt },
        'api: non-OK response',
      );

      if (!retriable) {
        throw new WorkerHttpError(
          `API ${init.method} ${opts.pathname} failed: ${res.status}`,
          { status: res.status, body, retriable: false },
        );
      }
      lastErr = new WorkerHttpError(
        `API ${init.method} ${opts.pathname} 5xx: ${res.status}`,
        { status: res.status, body, retriable: true },
      );
    } catch (err) {
      if (err instanceof WorkerHttpError && !err.retriable) throw err;
      lastErr = err;
      logger.warn(
        {
          method: init.method,
          pathname: opts.pathname,
          attempt,
          err: err instanceof Error ? err.message : String(err),
        },
        'api: network/server error, will retry',
      );
    }

    if (attempt < maxAttempts) {
      // Exponential backoff: 500ms, 1500ms, 3500ms (jittered)
      const base = 500 * Math.pow(3, attempt - 1);
      const jitter = Math.floor(Math.random() * 250);
      await sleep(base + jitter);
    }
  }

  if (lastErr instanceof Error) throw lastErr;
  throw new Error(`API ${opts.pathname} failed after ${maxAttempts} attempts`);
}

// ---- Public client functions ----

/**
 * Validate the worker token and pull current settings/state.
 * Endpoint: POST /api/worker/heartbeat
 */
export async function heartbeat(req: HeartbeatRequest = {}): Promise<HeartbeatResponse> {
  return apiFetch<HeartbeatResponse>({
    method: 'POST',
    pathname: '/api/worker/heartbeat',
    body: req,
  });
}

/**
 * Pull the next due job assigned to this user.
 * Endpoint: GET /api/worker/next-job
 *
 * Cloud responses:
 *   - 200 + JobPayload   -> claim succeeded, work to do
 *   - 204 No Content     -> nothing pending (apiFetch returns null)
 *   - 404 Not Found      -> treat as nothing pending (defensive)
 */
export async function getNextJob(): Promise<JobPayload | null> {
  try {
    const res = await apiFetch<JobPayload | null>({
      method: 'GET',
      pathname: '/api/worker/next-job',
    });
    if (!res || !res.job) return null;
    return res;
  } catch (err) {
    if (err instanceof WorkerHttpError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Report job result back to cloud.
 *
 * Primary endpoint:  PATCH /api/worker/jobs/:id
 * Legacy fallback:   POST  /api/worker/jobs/:id/result
 *
 * Older deployments don't have the PATCH route yet. We try PATCH first; if the
 * cloud returns 404 (route truly missing — distinguished from 404 "job not
 * found" by the response body, which is an HTML 404 page in the route-missing
 * case and JSON `{ error: ... }` in the not-found case), we fall back to the
 * POST endpoint that the cloud has always supported.
 */
/**
 * Bug #10 (iter7) — Playwright errors include the entire 56-retry call
 * log (~2000+ chars). The cloud's Zod validator caps `message` at 2000
 * which means we silently drop the entire status update for failed
 * jobs and the dashboard never shows them. Truncate to a safe ceiling
 * client-side; keep the head (the actual error message) and append a
 * marker so we know the original was longer.
 */
const MAX_MESSAGE_LENGTH = 1900;
function truncateMessage(message: string): string {
  if (message.length <= MAX_MESSAGE_LENGTH) return message;
  const head = message.substring(0, 1500);
  return `${head}\n\n... [truncated, original length ${message.length}]`;
}

export async function reportResult(
  jobId: string,
  payload: ReportResultPayload,
): Promise<void> {
  const id = encodeURIComponent(jobId);
  // Truncate before send so the cloud Zod validator doesn't 400 the request.
  const safePayload: ReportResultPayload = {
    ...payload,
    message: truncateMessage(payload.message),
  };
  try {
    await apiFetch<unknown>({
      method: 'PATCH',
      pathname: `/api/worker/jobs/${id}`,
      body: safePayload,
    });
    return;
  } catch (err) {
    // Only fall back when the *route* is missing, not when the cloud
    // legitimately rejected the report (e.g. 401 token issues, 404 with JSON
    // body for "job not claimed by this worker", 5xx that already retried).
    const isRouteMissing =
      err instanceof WorkerHttpError &&
      err.status === 404 &&
      // The Next.js 404 page is HTML; a real "job not found" is JSON.
      err.body.trimStart().startsWith('<');
    if (!isRouteMissing) throw err;
    logger.warn(
      { jobId },
      'api: PATCH /api/worker/jobs/:id is 404 on this deployment, falling back to POST /result',
    );
  }

  await apiFetch<unknown>({
    method: 'POST',
    pathname: `/api/worker/jobs/${id}/result`,
    body: safePayload,
  });
}

export interface RecheckTask {
  jobId: string;
  groupUrl: string;
  finishedAt: string | null;
  lastRecheckedAt: string | null;
}

/**
 * Pull the next pending-moderator-approval job to re-verify. Returns
 * null when nothing's eligible.
 */
export async function getNextRecheck(): Promise<RecheckTask | null> {
  try {
    const res = await apiFetch<RecheckTask | null>({
      method: 'GET',
      pathname: '/api/worker/next-recheck',
    });
    if (!res || !res.jobId) return null;
    return res;
  } catch (err) {
    // Older deployments without the route → just skip rechecks.
    if (err instanceof WorkerHttpError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Report a fresh recheck screenshot. The cloud GPT-4o classifier
 * decides whether the post is now visible (admin approved), still
 * pending, or rejected.
 */
export async function reportRecheck(jobId: string, screenshotUrl: string): Promise<void> {
  await apiFetch<unknown>({
    method: 'POST',
    pathname: '/api/worker/report-recheck',
    body: { jobId, screenshotUrl },
  });
}

/**
 * Update Facebook-connection status for the user owning this token.
 * Endpoint: POST /api/worker/connection-status
 */
export async function setConnectionStatus(
  payload: ConnectionStatusPayload,
): Promise<void> {
  await apiFetch<unknown>({
    method: 'POST',
    pathname: '/api/worker/connection-status',
    body: payload,
  });
}

/**
 * Upload a screenshot file. Multipart upload to the cloud, which forwards to
 * Supabase Storage and returns a public/signed URL.
 * Endpoint: POST /api/worker/upload-screenshot  (multipart/form-data, field "file")
 */
export async function uploadScreenshot(filePath: string): Promise<UploadScreenshotResponse> {
  const url = apiUrl('/api/worker/upload-screenshot');
  const maxAttempts = 3;
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const buffer = await fs.promises.readFile(filePath);
      const blob = new Blob([buffer], { type: 'image/png' });
      const form = new FormData();
      form.append('file', blob, path.basename(filePath));

      const res = await fetch(url, {
        method: 'POST',
        headers: { ...authHeaders() },
        body: form,
      });

      if (res.ok) {
        return (await res.json()) as UploadScreenshotResponse;
      }

      const body = await readBodyAsText(res);
      logger.error(
        { pathname: '/api/worker/upload-screenshot', status: res.status, body, attempt },
        'api: screenshot upload non-OK',
      );

      const retriable = res.status >= 500 && res.status <= 599;
      if (!retriable) {
        throw new WorkerHttpError(`Screenshot upload failed: ${res.status}`, {
          status: res.status,
          body,
          retriable: false,
        });
      }
      lastErr = new WorkerHttpError(`Screenshot upload 5xx: ${res.status}`, {
        status: res.status,
        body,
        retriable: true,
      });
    } catch (err) {
      if (err instanceof WorkerHttpError && !err.retriable) throw err;
      lastErr = err;
      logger.warn(
        { attempt, err: err instanceof Error ? err.message : String(err) },
        'api: screenshot upload error, will retry',
      );
    }

    if (attempt < maxAttempts) {
      const base = 500 * Math.pow(3, attempt - 1);
      const jitter = Math.floor(Math.random() * 250);
      await sleep(base + jitter);
    }
  }

  if (lastErr instanceof Error) throw lastErr;
  throw new Error('Screenshot upload failed after retries');
}
