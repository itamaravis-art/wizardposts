'use client';
import { useMemo } from 'react';
import { Check, X, AlertCircle, Loader, Send, Eye } from '@/lib/icons';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import type { AppEvent } from '@/lib/events';

export interface ActivityFeedProps {
  events: AppEvent[];
  /** How many to show (default 50) */
  limit?: number;
  className?: string;
  /** Empty state message */
  emptyHint?: string;
}

interface FeedRow {
  id: string;
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  detail?: string;
  ts: string;
}

function eventToRow(e: AppEvent, idx: number): FeedRow | null {
  const id = `${(e as any).id ?? idx}-${(e as any).ts ?? ''}`;
  const ts: string = (e as any).ts ?? (e as any).created_at ?? new Date().toISOString();

  // Best-effort mapping. The events feed is intentionally permissive — we don't know the exact
  // shape produced by the parallel agent's events.ts, so we read common fields.
  const type: string = (e as any).type ?? (e as any).kind ?? 'info';
  const message: string = (e as any).message ?? (e as any).text ?? '';
  const groupName: string | undefined = (e as any).group_name ?? (e as any).group;

  switch (type) {
    case 'job.success':
    case 'post.success':
    case 'success':
      return {
        id,
        icon: <Check size={14} />,
        iconClass: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
        title: groupName ? `פורסם ב-${groupName}` : 'פוסט פורסם בהצלחה',
        detail: message || undefined,
        ts,
      };
    case 'job.failed':
    case 'post.failed':
    case 'error':
    case 'failed':
      return {
        id,
        icon: <X size={14} />,
        iconClass: 'bg-red-100 text-red-700 ring-1 ring-red-200',
        title: groupName ? `נכשל ב-${groupName}` : 'משימה נכשלה',
        detail: message || undefined,
        ts,
      };
    case 'job.running':
    case 'job.started':
    case 'running':
      return {
        id,
        icon: <Loader size={14} className="animate-spin" />,
        iconClass: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200',
        title: groupName ? `מפרסם ב-${groupName}…` : 'מפרסם…',
        detail: message || undefined,
        ts,
      };
    case 'campaign.started':
      return {
        id,
        icon: <Send size={14} />,
        iconClass: 'bg-brand-100 text-brand-700 ring-1 ring-brand-200',
        title: 'קמפיין הופעל',
        detail: message || undefined,
        ts,
      };
    case 'campaign.paused':
      return {
        id,
        icon: <AlertCircle size={14} />,
        iconClass: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
        title: 'קמפיין הושהה',
        detail: message || undefined,
        ts,
      };
    case 'connect.update':
    case 'fb.connected':
      return {
        id,
        icon: <Eye size={14} />,
        iconClass: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200',
        title: 'עדכון חיבור',
        detail: message || undefined,
        ts,
      };
    default:
      // Generic fallback so unknown event types still appear
      if (!message) return null;
      return {
        id,
        icon: <AlertCircle size={14} />,
        iconClass: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
        title: type.replace(/[_.]/g, ' '),
        detail: message,
        ts,
      };
  }
}

export default function ActivityFeed({
  events,
  limit = 50,
  className,
  emptyHint = 'עוד אין פעילות. ברגע שהמערכת תפרסם משהו — הוא יופיע כאן בזמן אמת.',
}: ActivityFeedProps) {
  const rows = useMemo(() => {
    const mapped: FeedRow[] = [];
    for (let i = 0; i < events.length && mapped.length < limit; i++) {
      const r = eventToRow(events[i], i);
      if (r) mapped.push(r);
    }
    return mapped;
  }, [events, limit]);

  if (rows.length === 0) {
    return <p className="text-sm text-slate-500 leading-relaxed">{emptyHint}</p>;
  }

  return (
    <ol
      className={cn('space-y-2 max-h-[420px] overflow-y-auto pe-1', className)}
      aria-live="polite"
      aria-label="פעילות בזמן אמת"
    >
      {rows.map((r) => (
        <li
          key={r.id}
          className="group flex items-start gap-2.5 p-2 rounded-md hover:bg-slate-50 transition-colors duration-150"
        >
          <span
            className={cn('shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full', r.iconClass)}
            aria-hidden
          >
            {r.icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-slate-800 truncate">{r.title}</span>
              <time
                className="text-[11px] text-slate-500 shrink-0 tabular-nums"
                dateTime={r.ts}
                title={new Date(r.ts).toLocaleString('he-IL')}
              >
                {formatRelative(r.ts)}
              </time>
            </div>
            {r.detail && (
              <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">{r.detail}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
