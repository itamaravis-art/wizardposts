// Mirrors src/types/models.ts (kept local because web has its own tsconfig)
export type ID = number;
export type ISODate = string;

export interface Post {
  id: ID;
  text: string;
  image_path: string | null;
  created_at: ISODate;
}

export interface Group {
  id: ID;
  url: string;
  name: string | null;
  tag: string | null;
  last_posted_at: ISODate | null;
  success_count: number;
  fail_count: number;
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
  text_variations: 0 | 1;
  created_at: ISODate;
  started_at: ISODate | null;
  finished_at: ISODate | null;
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
  id: 1;
  daily_cap: number;
  min_delay_ms: number;
  max_delay_ms: number;
  work_hours_start: number;
  work_hours_end: number;
  max_consecutive_fails: number;
  typing_min_ms: number;
  typing_max_ms: number;
  fb_connected: 0 | 1;
  fb_user_name: string | null;
  fb_connected_at: ISODate | null;
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
  active_campaigns: Array<Campaign & { total_jobs: number; done_jobs: number }>;
  recent_jobs: Array<Job & { group_name?: string | null; group_url?: string }>;
  recent_errors: LogEntry[];
  fb_connected: 0 | 1;
  fb_user_name: string | null;
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

