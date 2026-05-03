'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPost } from '@/lib/api';
import type { Campaign, CampaignStatus, Post, ID } from '@/lib/types';
import { formatRelative, statusLabel } from '@/lib/format';
import { cn } from '@/lib/cn';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Dialog } from '@/components/ui/Dialog';
import { Tooltip } from '@/components/ui/Tooltip';

import { toast } from '@/lib/toast';
import { useEvents } from '@/lib/useEvents';
import {
  Plus,
  Play,
  Pause,
  X,
  Send,
  Image as ImageIcon,
  Eye,
  AlertCircle,
} from '@/lib/icons';

interface CampaignWithStats extends Campaign {
  total_jobs?: number;
  done_jobs?: number;
  post?: Post;
}

const FILTERS: Array<{ value: 'all' | CampaignStatus; label: string }> = [
  { value: 'all', label: 'הכל' },
  { value: 'running', label: 'פעיל' },
  { value: 'paused', label: 'מושהה' },
  { value: 'draft', label: 'טיוטה' },
  { value: 'done', label: 'הסתיים' },
];

function statusBadgeVariant(s: CampaignStatus): 'success' | 'warning' | 'danger' | 'info' | 'secondary' {
  switch (s) {
    case 'running':
      return 'info';
    case 'done':
      return 'success';
    case 'paused':
      return 'warning';
    case 'error':
    case 'cancelled':
      return 'danger';
    default:
      return 'secondary';
  }
}

function imageSrc(p: string | null | undefined): string | null {
  if (!p) return null;
  if (/^https?:\/\//.test(p)) return p; // cloud Supabase URL
  const base = p.split(/[/\\]/).pop();
  return base ? `/images/${base}` : null;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | CampaignStatus>('all');
  const [confirm, setConfirm] = useState<{ id: ID; action: 'cancel' } | null>(null);
  const [busy, setBusy] = useState<ID | null>(null);

  // SSE for live progress
  const { events } = useEvents(['job.finished', 'campaign.updated', 'campaign.progress']);

  async function load(showSkeleton = true) {
    if (showSkeleton) setLoading(true);
    try {
      const data = await apiGet<CampaignWithStats[]>('/api/campaigns');
      setCampaigns(data);
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה בטעינה');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // React to SSE events: refresh affected campaign
  useEffect(() => {
    if (!events || events.length === 0) return;
    const ev = events[0]; // newest event
    if (!ev) return;
    // Lightweight: refresh entire list (no skeleton)
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events?.[0]?.id]);

  const filtered = useMemo(() => {
    if (filter === 'all') return campaigns;
    return campaigns.filter((c) => c.status === filter);
  }, [campaigns, filter]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: campaigns.length };
    for (const c of campaigns) map[c.status] = (map[c.status] ?? 0) + 1;
    return map;
  }, [campaigns]);

  async function action(id: ID, type: 'start' | 'pause' | 'resume' | 'cancel') {
    setBusy(id);
    try {
      await apiPost(`/api/campaigns/${id}/${type}`);
      const labels: Record<typeof type, string> = {
        start: 'הקמפיין הופעל',
        pause: 'הקמפיין הושהה',
        resume: 'הקמפיין ממשיך',
        cancel: 'הקמפיין בוטל',
      };
      toast.success(labels[type]);
      load(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה בפעולה');
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold">קמפיינים</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            ניהול ומעקב חי אחר קמפיינים פעילים.
          </p>
        </div>
        <Link href="/campaigns/new">
          <Button icon={<Plus size={16} />}>קמפיין חדש</Button>
        </Link>
      </div>

      {/* Filter pills */}
      {!loading && campaigns.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            const count = counts[f.value] ?? 0;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                  active
                    ? 'bg-brand-600 text-white'
                    : 'bg-white dark:bg-surface border border-slate-200 dark:border-border text-slate-700 dark:text-foreground hover:bg-slate-50 dark:hover:bg-surface-2'
                )}
              >
                <span>{f.label}</span>
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    active ? 'opacity-90' : 'text-slate-400'
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} padded className="space-y-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-9 w-32" />
            </Card>
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={<Send size={28} />}
          title="עוד אין קמפיינים"
          description="קמפיין הוא תזמון של פוסט מסוים אל מספר קבוצות, עם תקרה יומית והשהיות. אפשר להתחיל עם הראשון."
          action={
            <Link href="/campaigns/new">
              <Button icon={<Plus size={16} />}>צור קמפיין ראשון</Button>
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Eye size={28} />}
          title="אין קמפיינים בסינון זה"
          description={`אין קמפיינים במצב "${FILTERS.find((f) => f.value === filter)?.label}".`}
          action={<Button variant="secondary" onClick={() => setFilter('all')}>הצג הכל</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => {
            const total = (c as any).progress?.total ?? c.total_jobs ?? 0;
            const done = (c as any).progress?.done ?? c.done_jobs ?? 0;
            const pct = total > 0 ? (done / total) * 100 : 0;
            const isRunning = c.status === 'running';
            const src = imageSrc(c.post?.imageUrl ?? c.post?.image_path);
            return (
              <Card
                key={c.id}
                hoverLift
                className="flex flex-col overflow-hidden group"
              >
                {/* Live indicator strip */}
                {isRunning && (
                  <div className="h-1 w-full bg-gradient-to-l from-brand-500 to-blue-500 animate-pulse" />
                )}

                <div className="p-4 space-y-3 flex flex-col flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="text-base font-semibold hover:text-brand-600 dark:hover:text-brand-400 transition-colors line-clamp-1 flex-1"
                    >
                      {c.name}
                    </Link>
                    <Badge variant={statusBadgeVariant(c.status)} className="shrink-0">
                      {isRunning && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse mr-1" />
                      )}
                      {statusLabel[c.status] ?? c.status}
                    </Badge>
                  </div>

                  {/* Post preview */}
                  <Link
                    href={`/campaigns/${c.id}`}
                    className="flex gap-3 p-2 -mx-1 rounded-lg hover:bg-slate-50 dark:hover:bg-surface-2 transition-colors"
                  >
                    {src ? (
                      <img
                        src={src}
                        alt=""
                        className="w-14 h-14 rounded object-cover bg-slate-100 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded bg-gradient-to-br from-slate-100 to-slate-200 dark:from-surface-2 dark:to-surface flex items-center justify-center text-slate-400 shrink-0">
                        <ImageIcon size={20} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      {c.post?.text ? (
                        <p className="text-xs text-slate-600 dark:text-muted-foreground line-clamp-3 whitespace-pre-wrap leading-relaxed">
                          {c.post.text}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-400 italic">
                          הפוסט אינו זמין
                        </p>
                      )}
                    </div>
                  </Link>

                  {c.last_error && (
                    <div className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded p-2 flex items-start gap-1.5">
                      <AlertCircle size={12} className="mt-0.5 shrink-0" />
                      <span className="line-clamp-2">{c.last_error}</span>
                    </div>
                  )}

                  <div className="space-y-1.5 mt-auto">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-slate-500">התקדמות</span>
                      <span className="tabular-nums font-medium">
                        {done} / {total || '—'}{' '}
                        {total > 0 && (
                          <span className="text-slate-400">({Math.round(pct)}%)</span>
                        )}
                      </span>
                    </div>
                    <ProgressBar value={done} max={total} animated={isRunning} />
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-border">
                    <span className="text-xs text-slate-500">
                      {c.started_at
                        ? `התחיל ${formatRelative(c.started_at)}`
                        : `נוצר ${formatRelative(c.created_at)}`}
                    </span>
                    <CampaignActions
                      status={c.status}
                      busy={busy === c.id}
                      onAction={(t) => {
                        if (t === 'cancel') setConfirm({ id: c.id, action: 'cancel' });
                        else action(c.id, t);
                      }}
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Cancel confirm */}
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="ביטול קמפיין"
        description="ביטול קמפיין יעצור משימות פעילות. משימות שכבר הסתיימו נשמרות."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy !== null}>
              חזור
            </Button>
            <Button
              variant="danger"
              icon={<X size={16} />}
              onClick={() => confirm && action(confirm.id, confirm.action)}
              loading={busy !== null}
            >
              בטל קמפיין
            </Button>
          </>
        }
      />
    </div>
  );
}

function CampaignActions({
  status,
  busy,
  onAction,
}: {
  status: CampaignStatus;
  busy: boolean;
  onAction: (type: 'start' | 'pause' | 'resume' | 'cancel') => void;
}) {
  return (
    <div className="flex gap-1">
      {status === 'draft' && (
        <Tooltip content="התחל קמפיין">
          <Button
            size="sm"
            icon={<Play size={14} />}
            onClick={() => onAction('start')}
            loading={busy}
          >
            הפעל
          </Button>
        </Tooltip>
      )}
      {status === 'running' && (
        <Tooltip content="השהה">
          <Button
            size="sm"
            variant="secondary"
            icon={<Pause size={14} />}
            onClick={() => onAction('pause')}
            loading={busy}
            aria-label="השהה"
          />
        </Tooltip>
      )}
      {status === 'paused' && (
        <Tooltip content="המשך">
          <Button
            size="sm"
            icon={<Play size={14} />}
            onClick={() => onAction('resume')}
            loading={busy}
          >
            המשך
          </Button>
        </Tooltip>
      )}
      {(status === 'running' || status === 'paused' || status === 'draft') && (
        <Tooltip content="בטל">
          <Button
            size="sm"
            variant="ghost"
            icon={<X size={14} />}
            onClick={() => onAction('cancel')}
            className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            aria-label="בטל"
          />
        </Tooltip>
      )}
    </div>
  );
}
