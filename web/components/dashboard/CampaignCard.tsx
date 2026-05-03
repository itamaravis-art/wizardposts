'use client';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Tooltip } from '@/components/ui/Tooltip';
import { Play, Pause, ExternalLink, Loader } from '@/lib/icons';
import { cn } from '@/lib/cn';
import { statusLabel } from '@/lib/format';
import type { Campaign, ID } from '@/lib/types';

export interface CampaignCardProps {
  campaign: Campaign & { total_jobs: number; done_jobs: number; current_group?: string | null };
  onPause?: (id: ID) => void | Promise<void>;
  onResume?: (id: ID) => void | Promise<void>;
  busy?: boolean;
  className?: string;
}

function statusTone(status: Campaign['status']): 'brand' | 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'running':
      return 'brand';
    case 'done':
      return 'success';
    case 'paused':
      return 'warning';
    case 'error':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Estimate completion using job progress + delay range. Best-effort guess. */
function estimateETA(
  total: number,
  done: number,
  minDelayMs: number,
  maxDelayMs: number,
): string {
  const remaining = Math.max(0, total - done);
  if (remaining === 0) return 'הקמפיין סיים';
  const avgMs = (minDelayMs + maxDelayMs) / 2;
  const ms = remaining * avgMs;
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return 'פחות מדקה';
  if (totalMin < 60) return `כ-${totalMin} דקות`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours < 24) return `כ-${hours} שעות${min ? ` ו-${min} דקות` : ''}`;
  const days = Math.floor(hours / 24);
  return `כ-${days} ימים`;
}

export default function CampaignCard({ campaign: c, onPause, onResume, busy, className }: CampaignCardProps) {
  const total = c.total_jobs ?? 0;
  const done = c.done_jobs ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const eta = estimateETA(total, done, c.min_delay_ms, c.max_delay_ms);
  const isRunning = c.status === 'running';
  const isPaused = c.status === 'paused';

  return (
    <Card className={cn('transition-all duration-200', className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {isRunning && (
                <span
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700"
                  aria-label="בריצה"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500" />
                  </span>
                  בריצה
                </span>
              )}
              <h3 className="text-lg font-semibold text-slate-900 truncate">{c.name}</h3>
              <Badge tone={statusTone(c.status)}>{statusLabel[c.status] ?? c.status}</Badge>
            </div>

            {c.current_group && isRunning && (
              <div className="mt-1.5 text-sm text-slate-600 inline-flex items-center gap-1.5">
                <Loader size={12} className="animate-spin text-brand-500" />
                <span className="truncate">מפרסם כעת ב-{c.current_group}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isRunning && onPause && (
              <Button variant="secondary" size="sm" onClick={() => onPause(c.id)} disabled={busy}>
                <Pause size={14} /> השהה
              </Button>
            )}
            {isPaused && onResume && (
              <Button variant="primary" size="sm" onClick={() => onResume(c.id)} disabled={busy}>
                <Play size={14} /> המשך
              </Button>
            )}
            <Link href={`/campaigns/${c.id}`}>
              <Button variant="ghost" size="sm" aria-label="פתח קמפיין">
                פתח <ExternalLink size={14} />
              </Button>
            </Link>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs text-slate-500 mb-1.5">
            <span className="font-medium text-slate-700">
              <span className="tabular-nums">{done}</span> מתוך <span className="tabular-nums">{total}</span> משימות
            </span>
            <Tooltip content="הערכה גסה — מבוססת על השהייה ממוצעת בין פוסטים">
              <span className="cursor-help">
                זמן משוער: <span className="font-semibold tabular-nums">{eta}</span>
              </span>
            </Tooltip>
          </div>
          <ProgressBar value={pct} max={100} aria-label={`התקדמות הקמפיין: ${pct}%`} />
        </div>

        {c.last_error && (
          <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            שגיאה אחרונה: <span className="font-medium">{c.last_error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
