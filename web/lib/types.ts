// Mirrors src/types/models.ts (kept local because web has its own tsconfig).
//
// IMPORTANT: The cloud SaaS backend uses Postgres UUIDs (string) for primary
// keys, while the original local desktop app used integer rowids (number).
// `ID` is therefore `string | number` — most call sites just pass the value
// through (template literals, Map keys, `===` comparisons) so this is safe.
export type ID = string | number;
export type ISODate = string;

export interface Post {
  id: ID;
  text: string;
  /** Cloud version: full Supabase public URL. */
  imageUrl?: string | null;
  /** Snake-case alias also emitted by the API for older callers. */
  image_url?: string | null;
  /** Legacy local version: filesystem path. */
  image_path?: string | null;
  /** Optional short-video URL (Supabase public URL). */
  videoUrl?: string | null;
  /** Snake-case alias. */
  video_url?: string | null;
  created_at?: ISODate;
  createdAt?: ISODate;
}

export interface Group {
  id: ID;
  url: string;
  name: string | null;
  tag: string | null;
  last_posted_at: ISODate | null;
  success_count: number;
  fail_count: number;
  /** Backend wires `0 | 1` (UI compares `=== 1`). Boolean is also tolerated. */
  active: 0 | 1;
  created_at: ISODate;
}

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'done' | 'cancelled' | 'error';

export interface Campaign {
  id: ID;
  name: string;
  post_id: ID;
  status: CampaignStatus;
  daily_cap: number;
  min_delay_ms: number;
  max_delay_ms: number;
  work_hours_start: number;
  work_hours_end: number;
  /** Backend wires snake_case boolean. UI treats truthy/falsy. */
  text_variations: 0 | 1 | boolean;
  created_at: ISODate;
  started_at: ISODate | null;
  finished_at: ISODate | null;
  /** When the campaign is queued to start. Null = start immediately. */
  scheduled_start_at?: ISODate | null;
  last_error: string | null;
}

export type JobStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface Job {
  id: ID;
  campaign_id: ID;
  group_id: ID;
  status: JobStatus;
  attempts: number;
  scheduled_at: ISODate | null;
  started_at: ISODate | null;
  finished_at: ISODate | null;
  result_message: string | null;
  screenshot_path: string | null;
}

export interface Settings {
  /** Singleton row id in the legacy local DB; not present in cloud. */
  id?: 1;
  daily_cap: number;
  min_delay_ms: number;
  max_delay_ms: number;
  work_hours_start: number;
  work_hours_end: number;
  max_consecutive_fails: number;
  typing_min_ms: number;
  typing_max_ms: number;
  /** Cloud may return boolean; legacy returned 0|1. Treat as truthy. */
  fb_connected: 0 | 1 | boolean;
  fb_user_name: string | null;
  /** Optional — present in legacy payloads, not always in cloud. */
  fb_connected_at?: ISODate | null;
}

export interface LogEntry {
  id: ID;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
  meta: string | null;
  created_at: ISODate;
}

export interface DashboardData {
  today_count: number;
  daily_cap: number;
  active_campaigns: Array<Campaign & { total_jobs: number; done_jobs: number; current_group?: string | null }>;
  recent_jobs: Array<Job & { group_name?: string | null; group_url?: string }>;
  recent_errors: LogEntry[];
  fb_connected: 0 | 1 | boolean;
  fb_user_name: string | null;
  /** Optional — present when the backend can compute them. */
  success_count?: number;
  fail_count?: number;
  pending_jobs?: number;
  yesterday_count?: number;
  work_hours_start?: number;
  work_hours_end?: number;
}

/* ───────────────── SaaS-only additions ───────────────── */

export interface MeResponse {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  fb_connected?: boolean;
  fb_user_name?: string | null;
  worker_online?: boolean;
  created_at?: ISODate;
}

export interface WorkerToken {
  id: string;
  name: string;
  last_used_at?: string | null;
  created_at: string;
  revoked_at?: string | null;
  /** Plaintext token — present only on creation response; never afterwards. */
  token?: string;
}
