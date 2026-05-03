import type { CampaignStatus, JobStatus } from './types';

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso).getTime();
    const now = Date.now();
    const diffSec = Math.round((now - d) / 1000);
    if (diffSec < 60) return 'לפני רגע';
    if (diffSec < 3600) return `לפני ${Math.floor(diffSec / 60)} דקות`;
    if (diffSec < 86400) return `לפני ${Math.floor(diffSec / 3600)} שעות`;
    return `לפני ${Math.floor(diffSec / 86400)} ימים`;
  } catch {
    return iso;
  }
}

export function msToMinutes(ms: number): number {
  return Math.round(ms / 60000);
}

export function minutesToMs(min: number): number {
  return Math.round(min * 60000);
}

export function statusColor(status: CampaignStatus | JobStatus): string {
  switch (status) {
    case 'running':
      return 'bg-blue-100 text-blue-800 ring-1 ring-blue-200';
    case 'success':
    case 'done':
      return 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200';
    case 'paused':
      return 'bg-amber-100 text-amber-800 ring-1 ring-amber-200';
    case 'failed':
    case 'error':
      return 'bg-red-100 text-red-800 ring-1 ring-red-200';
    case 'cancelled':
      return 'bg-slate-200 text-slate-700 ring-1 ring-slate-300';
    case 'skipped':
      return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200';
    case 'pending':
      return 'bg-indigo-100 text-indigo-800 ring-1 ring-indigo-200';
    case 'draft':
    default:
      return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
  }
}

export const statusLabel: Record<string, string> = {
  draft: 'טיוטה',
  running: 'פעיל',
  paused: 'מושהה',
  done: 'הושלם',
  cancelled: 'בוטל',
  error: 'שגיאה',
  pending: 'ממתין',
  success: 'הצלחה',
  failed: 'נכשל',
  skipped: 'דולג',
};
