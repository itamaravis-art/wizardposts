/**
 * web/lib/events.ts
 * TypeScript mirror of `src/types/events.ts` for the Next.js admin UI.
 *
 * The web app has its own tsconfig + module graph and intentionally does not
 * import from `../../src` (which would drag in zod, better-sqlite3, etc.).
 * Keep these definitions in sync with the server side manually.
 */

export type CampaignStatus =
  | 'draft'
  | 'running'
  | 'paused'
  | 'done'
  | 'cancelled'
  | 'error';

export interface EventEnvelope {
  type: string;
  id: string;
  ts: string;
}

export interface WorkerTickEvent extends EventEnvelope {
  type: 'worker.tick';
}

export interface JobStartedEvent extends EventEnvelope {
  type: 'job.started';
  jobId: number;
  campaignId: number;
  groupId: number;
  groupName: string | null;
}

export interface JobSucceededEvent extends EventEnvelope {
  type: 'job.succeeded';
  jobId: number;
  campaignId: number;
  groupId: number;
  groupName: string | null;
  screenshotPath?: string | null;
}

export type JobBlockerKind =
  | 'captcha'
  | 'checkpoint'
  | 'login-required'
  | 'rate-limit'
  | 'unknown';

export interface JobFailedEvent extends EventEnvelope {
  type: 'job.failed';
  jobId: number;
  campaignId: number;
  groupId: number;
  groupName: string | null;
  message: string;
  blockerKind?: JobBlockerKind;
}

export interface CampaignStatusChangedEvent extends EventEnvelope {
  type: 'campaign.status_changed';
  campaignId: number;
  status: CampaignStatus;
  reason?: string;
}

export interface CampaignProgressEvent extends EventEnvelope {
  type: 'campaign.progress';
  campaignId: number;
  total: number;
  done: number;
  success: number;
  failed: number;
}

export interface ConnectionChangedEvent extends EventEnvelope {
  type: 'connection.changed';
  connected: boolean;
  userName?: string | null;
}

export type SafetyGate =
  | 'work_hours'
  | 'daily_cap'
  | 'consecutive_fails'
  | 'fb_disconnected';

export interface SafetyGateTriggeredEvent extends EventEnvelope {
  type: 'safety.gate_triggered';
  gate: SafetyGate;
  detail?: string;
}

export interface LogAddedEvent extends EventEnvelope {
  type: 'log.added';
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
}

export type AppEvent =
  | WorkerTickEvent
  | JobStartedEvent
  | JobSucceededEvent
  | JobFailedEvent
  | CampaignStatusChangedEvent
  | CampaignProgressEvent
  | ConnectionChangedEvent
  | SafetyGateTriggeredEvent
  | LogAddedEvent;

export type AppEventType = AppEvent['type'];
