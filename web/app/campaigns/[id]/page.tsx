'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiGet, apiPost } from '@/lib/api';
import type { Campaign, Job, JobStatus, Post } from '@/lib/types';
import { formatDate, formatRelative, msToMinutes, statusLabel } from '@/lib/format';
import { cn } from '@/lib/cn';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Dialog } from '@/components/ui/Dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { Tooltip } from '@/components/ui/Tooltip';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

import { toast } from '@/lib/toast';
import { useEvents } from '@/lib/useEvents';
import {
  ArrowRight,
  Play,
  Pause,
  X,
  Check,
  AlertCircle,
  Clock,
  ExternalLink,
  Image as ImageIcon,
  Search,
  Eye,
} from '@/lib/icons';

interface CampaignDetail extends Campaign {
  jobs: Array<Job & { group_name?: string | null; group_url?: string }>;
  total_jobs: number;
  done_jobs: number;
  post?: Post;
}

interface ActivityEvent {
  id: string;
  type: string;
  timestamp: number;
  payload?: any;
}

function jobStatusVariant(s: JobStatus): 'success' | 'danger' | 'info' | 'warning' | 'secondary' {
  switch (s) {
    case 'success':
      return 'success';
    case 'failed':
      return 'danger';
    case 'running':
      return 'info';
    case 'pending':
      return 'warning';
    case 'skipped':
    default:
      return 'secondary';
  }
}

function campaignStatusVariant(s: Campaign['status']): 'success' | 'warning' | 'danger' | 'info' | 'secondary' {
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
  const base = p.split(/[/\\]/).pop();
  return base ? `/images/${base}` : null;
}
function screenshotSrc(p: string | null | undefined): string | null {
  if (!p) return null;
  const base = p.split(/[/\\]/).pop();
  return base ? `/screenshots/${base}` : null;
}

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [data, setData] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  // Job filters
  const [jobSearch, setJobSearch] = useState('');
  const [jobStatusFilter, setJobStatusFilter] = useState<JobStatus | 'all'>('all');

  // Activity log (SSE-derived)
  const [activity, setActivity] = useState<ActivityEvent[]>([]);

  // SSE
  const { events } = useEvents();

  async function load(showSkeleton = false) {
    if (showSkeleton) setLoading(true);
    try {
      const d = await apiGet<CampaignDetail>(`/api/campaigns/${id}`);
      setData(d);
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה בטעינה');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    load(true);
    // soft-poll fallback every 8s
    const t = setInterval(() => load(false), 8000);
    return () => clearInterval(t);
  }, [id]);

  // React to SSE — filter to this campaign
  useEffect(() => {
    if (!events || events.length === 0) return;
    const newest = events[0];
    if (!newest) return;
    const anyEv = newest as any;
    const cid = anyEv.campaignId;
    if (cid !== undefined && String(cid) !== String(id)) return;
    // Refresh + prepend to activity
    setActivity((prev) =>
      [
        {
          id: newest.id ?? `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: newest.type ?? 'event',
          timestamp: new Date(newest.ts ?? Date.now()).getTime(),
          payload: anyEv,
        },
        ...prev,
      ].slice(0, 200)
    );
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events?.[0]?.id]);

  async function action(type: 'start' | 'pause' | 'resume' | 'cancel') {
    setBusy(true);
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
      toast.error(e?.message ?? 'שגיאה');
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  }

  // Stats
  const stats = useMemo(() => {
    if (!data) return { total: 0, done: 0, success: 0, failed: 0, pending: 0, running: 0 };
    let success = 0, failed = 0, pending = 0, running = 0;
    for (const j of data.jobs ?? []) {
      if (j.status === 'success') success++;
      else if (j.status === 'failed') failed++;
      else if (j.status === 'pending') pending++;
      else if (j.status === 'running') running++;
    }
    // Prefer authoritative progress from API; fall back to in-memory tally.
    const p = (data as any).progress;
    return {
      total: p?.total ?? data.total_jobs ?? data.jobs?.length ?? 0,
      done: p?.done ?? data.done_jobs ?? success + failed,
      success: p?.success ?? success,
      failed: p?.failed ?? failed,
      pending: p?.pending ?? pending,
      running,
    };
  }, [data]);

  // Filtered jobs
  const filteredJobs = useMemo(() => {
    if (!data) return [];
    let out = data.jobs ?? [];
    if (jobStatusFilter !== 'all') {
      out = out.filter((j) => j.status === jobStatusFilter);
    }
    if (jobSearch.trim()) {
      const s = jobSearch.toLowerCase();
      out = out.filter(
        (j) =>
          (j.group_name ?? '').toLowerCase().includes(s) ||
          (j.group_url ?? '').toLowerCase().includes(s) ||
          (j.result_message ?? '').toLowerCase().includes(s)
      );
    }
    return out;
  }, [data, jobStatusFilter, jobSearch]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <Card padded className="text-center text-slate-500">
        הקמפיין לא נמצא.
      </Card>
    );
  }

  const isRunning = data.status === 'running';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowRight size={16} />}
            onClick={() => router.push('/campaigns')}
            aria-label="חזרה"
          />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold truncate">{data.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant={campaignStatusVariant(data.status)}>
                {isRunning && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse mr-1" />
                )}
                {statusLabel[data.status] ?? data.status}
              </Badge>
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <Clock size={12} />
                נוצר {formatRelative(data.created_at)}
              </span>
              {data.started_at && (
                <span className="text-xs text-slate-500">
                  · התחיל {formatRelative(data.started_at)}
                </span>
              )}
              {data.finished_at && (
                <span className="text-xs text-slate-500">
                  · הסתיים {formatRelative(data.finished_at)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {data.status === 'draft' && (
            <Button
              icon={<Play size={16} />}
              onClick={() => action('start')}
              loading={busy}
            >
              הפעל
            </Button>
          )}
          {data.status === 'running' && (
            <Button
              variant="secondary"
              icon={<Pause size={16} />}
              onClick={() => action('pause')}
              loading={busy}
            >
              השהה
            </Button>
          )}
          {data.status === 'paused' && (
            <Button
              icon={<Play size={16} />}
              onClick={() => action('resume')}
              loading={busy}
            >
              המשך
            </Button>
          )}
          {(data.status === 'running' || data.status === 'paused' || data.status === 'draft') && (
            <Button
              variant="danger"
              icon={<X size={16} />}
              onClick={() => setConfirmCancel(true)}
            >
              בטל
            </Button>
          )}
        </div>
      </div>

      {/* Last error */}
      {data.last_error && (
        <Card padded className="bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900">
          <div className="flex items-start gap-2 text-red-800 dark:text-red-200">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-semibold">שגיאה אחרונה</div>
              <div className="text-sm mt-1">{data.last_error}</div>
            </div>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <KpiCard label="סך הכל" value={stats.total} />
        <KpiCard label="הסתיימו" value={stats.done} accent="brand" />
        <KpiCard label="הצליחו" value={stats.success} accent="success" />
        <KpiCard label="נכשלו" value={stats.failed} accent="danger" />
        <KpiCard label="ממתינים" value={stats.pending + stats.running} accent="warning" />
      </div>

      {/* Live progress */}
      <Card padded className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">התקדמות</h2>
          <span className="text-sm tabular-nums text-slate-600 dark:text-muted-foreground">
            {stats.done} / {stats.total}{' '}
            {stats.total > 0 && (
              <span className="text-slate-400">
                ({Math.round((stats.done / stats.total) * 100)}%)
              </span>
            )}
          </span>
        </div>
        <ProgressBar value={stats.done} max={stats.total} animated={isRunning} />
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="jobs">
        <TabsList>
          <TabsTrigger value="jobs">משימות ({data.jobs?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="settings">הגדרות</TabsTrigger>
          <TabsTrigger value="activity">פעילות</TabsTrigger>
        </TabsList>

        <TabsContent value="jobs">
          <Card className="overflow-hidden">
            <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-border">
              <Input
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
                placeholder="חיפוש לפי קבוצה או הודעה..."
                icon={<Search size={16} />}
                className="flex-1 min-w-[14rem]"
              />
              <Select
                value={jobStatusFilter}
                onChange={(e) => setJobStatusFilter(e.target.value as any)}
              >
                <option value="all">כל הסטטוסים</option>
                <option value="success">הצלחה</option>
                <option value="failed">נכשל</option>
                <option value="running">פעיל</option>
                <option value="pending">ממתין</option>
                <option value="skipped">דולג</option>
              </Select>
            </div>

            {filteredJobs.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                {data.jobs?.length === 0
                  ? 'אין משימות עדיין.'
                  : 'אין משימות שתואמות לסינון.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-surface-2 text-slate-600 dark:text-muted-foreground border-b border-slate-200 dark:border-border">
                    <tr>
                      <th className="text-right p-3 font-semibold">קבוצה</th>
                      <th className="text-right p-3 font-semibold">סטטוס</th>
                      <th className="text-right p-3 font-semibold">הודעה</th>
                      <th className="text-right p-3 font-semibold">נסיונות</th>
                      <th className="text-right p-3 font-semibold">זמן</th>
                      <th className="text-right p-3 font-semibold">צילום</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJobs.map((j) => {
                      const isFailed = j.status === 'failed';
                      const sshot = screenshotSrc(j.screenshot_path);
                      return (
                        <tr
                          key={j.id}
                          className={cn(
                            'border-b border-slate-100 dark:border-border last:border-0 transition-colors',
                            isFailed
                              ? 'bg-red-50/40 dark:bg-red-950/10 border-r-4 border-r-red-400'
                              : 'hover:bg-slate-50 dark:hover:bg-surface-2'
                          )}
                        >
                          <td className="p-3 max-w-[16rem]">
                            {j.group_url ? (
                              <a
                                href={j.group_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 hover:text-brand-600 dark:hover:text-brand-400 transition-colors truncate max-w-full"
                                title={j.group_name ?? j.group_url}
                              >
                                <span className="truncate">
                                  {j.group_name || j.group_url}
                                </span>
                                <ExternalLink size={12} className="shrink-0 opacity-60" />
                              </a>
                            ) : (
                              <span>#{j.group_id}</span>
                            )}
                          </td>
                          <td className="p-3">
                            <Badge variant={jobStatusVariant(j.status)}>
                              {statusLabel[j.status] ?? j.status}
                            </Badge>
                          </td>
                          <td
                            className={cn(
                              'p-3 max-w-md',
                              isFailed
                                ? 'text-red-700 dark:text-red-300'
                                : 'text-slate-600 dark:text-muted-foreground'
                            )}
                          >
                            <div className="line-clamp-2 break-words">
                              {j.result_message || (
                                <span className="text-slate-400">—</span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 tabular-nums">{j.attempts}</td>
                          <td className="p-3 text-xs text-slate-500 whitespace-nowrap">
                            {formatRelative(
                              j.finished_at || j.started_at || j.scheduled_at
                            )}
                          </td>
                          <td className="p-3">
                            {sshot ? (
                              <button
                                type="button"
                                onClick={() => setZoomImage(sshot)}
                                className="block w-12 h-12 bg-slate-100 dark:bg-surface-2 rounded overflow-hidden hover:ring-2 hover:ring-brand-500 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                                aria-label="הצג צילום מסך"
                              >
                                <img
                                  src={sshot}
                                  alt="צילום"
                                  className="w-full h-full object-cover"
                                />
                              </button>
                            ) : (
                              <span className="text-slate-400 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card padded className="space-y-3">
            <h3 className="font-semibold">סיכום הגדרות</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
              <SettingRow label="פוסט">
                {data.post ? (
                  <div className="flex gap-2 items-start">
                    {imageSrc(data.post.image_path) ? (
                      <img
                        src={imageSrc(data.post.image_path)!}
                        alt=""
                        className="w-12 h-12 rounded object-cover bg-slate-100"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded bg-slate-100 dark:bg-surface-2 flex items-center justify-center text-slate-400">
                        <ImageIcon size={16} />
                      </div>
                    )}
                    <p className="text-xs line-clamp-3 flex-1">{data.post.text}</p>
                  </div>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </SettingRow>
              <SettingRow label="תקרה יומית">
                <strong className="tabular-nums">{data.daily_cap}</strong> פוסטים
              </SettingRow>
              <SettingRow label="השהיה בין פרסומים">
                <strong className="tabular-nums">
                  {msToMinutes(data.min_delay_ms)}–{msToMinutes(data.max_delay_ms)}
                </strong>{' '}
                דקות
              </SettingRow>
              <SettingRow label="שעות פעילות">
                <strong>
                  {data.work_hours_start}:00 – {data.work_hours_end}:00
                </strong>
              </SettingRow>
              <SettingRow label="וריאציות טקסט">
                <Badge variant={data.text_variations ? 'success' : 'secondary'}>
                  {data.text_variations ? 'מופעל' : 'כבוי'}
                </Badge>
              </SettingRow>
              <SettingRow label="נוצר">
                <span className="text-slate-500">{formatDate(data.created_at)}</span>
              </SettingRow>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card padded>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">יומן פעילות חי</h3>
              <span className="text-xs text-slate-500">
                {activity.length === 0
                  ? 'ממתין לאירועים...'
                  : `${activity.length} אירועים אחרונים`}
              </span>
            </div>
            {activity.length === 0 ? (
              <div className="text-sm text-slate-500 text-center py-8">
                אירועים יופיעו כאן בזמן אמת כשהקמפיין פעיל.
              </div>
            ) : (
              <ol className="relative border-r-2 border-slate-200 dark:border-border pr-4 space-y-3">
                {activity.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -right-[1.4rem] top-1 w-3 h-3 rounded-full bg-brand-500 ring-4 ring-white dark:ring-surface" />
                    <div className="text-xs text-slate-500">
                      {formatRelative(new Date(e.timestamp).toISOString())}
                    </div>
                    <div className="text-sm font-mono">{e.type}</div>
                    {e.payload && (
                      <details className="mt-1">
                        <summary className="text-xs text-slate-400 cursor-pointer">
                          פרטים
                        </summary>
                        <pre
                          dir="ltr"
                          className="text-xs bg-slate-50 dark:bg-surface-2 rounded p-2 mt-1 overflow-x-auto"
                        >
                          {JSON.stringify(e.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Screenshot zoom */}
      <Dialog
        open={!!zoomImage}
        onClose={() => setZoomImage(null)}
        title="צילום מסך"
        size="xl"
      >
        {zoomImage && (
          <div className="space-y-2">
            <img
              src={zoomImage}
              alt="צילום מסך"
              className="w-full h-auto rounded-lg bg-slate-50"
            />
            <div className="flex justify-end">
              <a href={zoomImage} target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm" icon={<ExternalLink size={14} />}>
                  פתח במלוא הגודל
                </Button>
              </a>
            </div>
          </div>
        )}
      </Dialog>

      {/* Cancel confirm */}
      <Dialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="ביטול קמפיין"
        description="ביטול הקמפיין יעצור משימות פעילות. משימות שכבר הסתיימו נשמרות."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)} disabled={busy}>
              חזור
            </Button>
            <Button
              variant="danger"
              icon={<X size={16} />}
              onClick={() => action('cancel')}
              loading={busy}
            >
              בטל קמפיין
            </Button>
          </>
        }
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'brand' | 'success' | 'danger' | 'warning';
}) {
  const accentClass = {
    brand: 'text-brand-700 dark:text-brand-300',
    success: 'text-emerald-700 dark:text-emerald-400',
    danger: 'text-red-700 dark:text-red-400',
    warning: 'text-amber-700 dark:text-amber-400',
  };
  return (
    <Card padded>
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div
        className={cn(
          'text-2xl font-bold tabular-nums mt-1',
          accent ? accentClass[accent] : 'text-slate-900 dark:text-foreground'
        )}
      >
        {value}
      </div>
    </Card>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
