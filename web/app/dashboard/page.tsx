'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPost } from '@/lib/api';
import type { DashboardData } from '@/lib/types';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Send, Calendar, Plus } from '@/lib/icons';
import { toast } from '@/lib/toast';
import { useEvents } from '@/lib/useEvents';
import type { AppEvent } from '@/lib/events';

import StatCard from '@/components/dashboard/StatCard';
import CampaignCard from '@/components/dashboard/CampaignCard';
import ActivityFeed from '@/components/dashboard/ActivityFeed';
import HourlyChart, { HourBucket } from '@/components/dashboard/HourlyChart';
import DonutChart from '@/components/dashboard/DonutChart';
import SafetyIndicator from '@/components/dashboard/SafetyIndicator';
import QuickActions from '@/components/dashboard/QuickActions';

interface ExtendedDashboardData extends DashboardData {
  /** Optional: backend may return aggregated counts for sparklines */
  daily_counts?: number[]; // last N days
  hourly_buckets?: HourBucket[]; // last 24h
  success_count?: number;
  fail_count?: number;
  pending_jobs?: number;
  yesterday_count?: number;
  work_hours_start?: number;
  work_hours_end?: number;
  daily_cap_today?: number;
}

const REVALIDATE_MS = 30_000;

/** Derive an hourly bucket array from recent_jobs as a fallback. */
function deriveHourlyFromJobs(data: DashboardData): HourBucket[] {
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    posted: 0,
    failed: 0,
  }));
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  for (const j of data.recent_jobs ?? []) {
    const tsRaw = j.finished_at || j.started_at || j.scheduled_at;
    if (!tsRaw) continue;
    const ts = new Date(tsRaw).getTime();
    if (Number.isNaN(ts) || ts < cutoff) continue;
    const hour = new Date(ts).getHours();
    if (j.status === 'success') buckets[hour].posted += 1;
    else if (j.status === 'failed') buckets[hour].failed += 1;
  }
  return buckets;
}

/** Derive a tiny "today vs yesterday" sparkline from whatever we have. */
function placeholderSparkline(today: number, prior?: number, length = 7): number[] {
  const base = prior ?? Math.max(1, Math.round(today * 0.7));
  const arr = Array.from({ length }, (_, i) => {
    const t = i / (length - 1);
    return Math.round(base + (today - base) * t);
  });
  return arr;
}

/** True if `now` hour is within [start, end). Handles wraparound (e.g. 22..6). */
function isWithinWorkHours(start: number, end: number): boolean {
  const h = new Date().getHours();
  if (start === end) return true;
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}

export default function DashboardPage() {
  const [data, setData] = useState<ExtendedDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyCampaign, setBusyCampaign] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<ExtendedDashboardData>('/api/dashboard');
      setData(d);
      setError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'שגיאה בטעינת לוח הבקרה';
      setError(msg);
    }
  }, []);

  // Initial fetch + revalidate every 30s
  useEffect(() => {
    let alive = true;
    (async () => {
      await load();
      if (!alive) return;
    })();
    const t = setInterval(load, REVALIDATE_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [load]);

  // SSE: fold each event into local state for live KPIs/feed.
  // We keep a rolling list of events on the client (cap 100).
  const [liveEvents, setLiveEvents] = useState<AppEvent[]>([]);
  // Track "live" deltas so KPIs update before the next 30s revalidate.
  const [liveDelta, setLiveDelta] = useState({ posted: 0, failed: 0, pending: 0 });

  // Seed live feed from /api/events/recent on mount (best-effort, optional).
  useEffect(() => {
    let alive = true;
    apiGet<AppEvent[]>('/api/events/recent')
      .then((evs) => {
        if (!alive || !Array.isArray(evs)) return;
        setLiveEvents(evs.slice(0, 50));
      })
      .catch(() => {
        /* silent — hook will populate as events arrive */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEvents((evt: AppEvent) => {
    setLiveEvents((prev) => [evt, ...prev].slice(0, 100));
    const type = (evt as any).type ?? (evt as any).kind ?? '';
    setLiveDelta((d) => {
      switch (type) {
        case 'job.success':
        case 'post.success':
          return { ...d, posted: d.posted + 1, pending: Math.max(0, d.pending - 1) };
        case 'job.failed':
        case 'post.failed':
          return { ...d, failed: d.failed + 1, pending: Math.max(0, d.pending - 1) };
        case 'job.queued':
          return { ...d, pending: d.pending + 1 };
        default:
          return d;
      }
    });
    // When a campaign-level event arrives, refresh the canonical data soon.
    if (typeof type === 'string' && type.startsWith('campaign.')) {
      void load();
    }
  });

  // Reset live deltas after each successful canonical refresh
  useEffect(() => {
    if (data) setLiveDelta({ posted: 0, failed: 0, pending: 0 });
  }, [data]);

  // ------- Derived KPIs -------
  const todayCount = (data?.today_count ?? 0) + liveDelta.posted;
  const dailyCap = data?.daily_cap ?? 0;
  const activeCampaigns = data?.active_campaigns ?? [];
  const pendingJobs =
    (data?.pending_jobs ??
      activeCampaigns.reduce((acc, c) => acc + Math.max(0, (c.total_jobs ?? 0) - (c.done_jobs ?? 0)), 0)) +
    liveDelta.pending;

  const successCount = (data?.success_count ?? 0) + liveDelta.posted;
  const failCount = (data?.fail_count ?? 0) + liveDelta.failed;
  const successRate = useMemo(() => {
    const total = successCount + failCount;
    return total > 0 ? Math.round((successCount / total) * 100) : 0;
  }, [successCount, failCount]);

  const trendToday = useMemo(
    () => data?.daily_counts && data.daily_counts.length > 1
      ? data.daily_counts
      : placeholderSparkline(todayCount, data?.yesterday_count),
    [data?.daily_counts, data?.yesterday_count, todayCount],
  );

  const hourlyBuckets = useMemo<HourBucket[]>(() => {
    if (data?.hourly_buckets && data.hourly_buckets.length > 0) return data.hourly_buckets;
    if (data) return deriveHourlyFromJobs(data);
    return Array.from({ length: 24 }, (_, h) => ({ hour: h, posted: 0, failed: 0 }));
  }, [data]);

  const trendTodayPct = useMemo(() => {
    const y = data?.yesterday_count;
    if (!y || y === 0) return undefined;
    return ((todayCount - y) / y) * 100;
  }, [data?.yesterday_count, todayCount]);

  const workStart = data?.work_hours_start ?? 9;
  const workEnd = data?.work_hours_end ?? 21;
  const withinHours = isWithinWorkHours(workStart, workEnd);
  const underDailyCap = dailyCap === 0 ? true : todayCount < dailyCap;

  // ------- Campaign actions (Pause/Resume) -------
  const handlePause = useCallback(async (id: number) => {
    setBusyCampaign(id);
    try {
      await apiPost(`/api/campaigns/${id}/pause`);
      toast.success('הקמפיין הושהה');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'לא הצלחנו להשהות. נסה שוב.');
    } finally {
      setBusyCampaign(null);
    }
  }, [load]);

  const handleResume = useCallback(async (id: number) => {
    setBusyCampaign(id);
    try {
      await apiPost(`/api/campaigns/${id}/resume`);
      toast.success('הקמפיין חזר לפעול');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'לא הצלחנו להמשיך. נסה שוב.');
    } finally {
      setBusyCampaign(null);
    }
  }, [load]);

  // ------- Render: error, loading, empty, full -------
  if (error && !data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">לוח בקרה</h1>
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-5 text-red-800">
            <p className="font-semibold mb-1">קצת בעיה בטעינת הנתונים</p>
            <p className="text-sm opacity-90">{error}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={load}>
              נסה שוב
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) {
    return <DashboardSkeleton />;
  }

  // First-run / empty state — no campaigns ever created
  const noCampaignsAtAll = activeCampaigns.length === 0 && (data.recent_jobs?.length ?? 0) === 0;
  if (noCampaignsAtAll) {
    return (
      <div className="space-y-6">
        <DashboardHeader />
        <Card>
          <CardContent className="p-10">
            <EmptyState
              icon={<Send size={32} />}
              title="הכל מוכן — בוא נצא לדרך"
              description="עוד לא יצרת קמפיין. הסטאפ הראשון לוקח דקה: חיבור לפייסבוק, הוספת קבוצות, ופוסט ראשון."
              action={
                <div className="flex flex-wrap gap-2 justify-center">
                  <Link href="/onboarding">
                    <Button variant="primary" size="lg">
                      <Plus size={16} /> התחל הגדרה מודרכת
                    </Button>
                  </Link>
                  <Link href="/campaigns/new">
                    <Button variant="secondary" size="lg">
                      <Calendar size={16} /> צור קמפיין ידנית
                    </Button>
                  </Link>
                </div>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardHeader />

      {/* Row 1: KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="פוסטים היום"
          value={todayCount}
          suffix={dailyCap > 0 ? `/ ${dailyCap}` : undefined}
          trendPct={trendTodayPct}
          trend={trendToday}
          tone="brand"
          hint="כמות הפוסטים שפורסמו מאז חצות, מול המכסה היומית."
        />
        <StatCard
          label="קמפיינים פעילים"
          value={activeCampaigns.length}
          tone="emerald"
          hint="קמפיינים שמצבם 'בריצה' או 'מושהה'."
          trend={activeCampaigns.length > 0 ? [0, 1, 1, 2, activeCampaigns.length] : undefined}
        />
        <StatCard
          label="שיעור הצלחה"
          value={`${successRate}%`}
          tone={successRate >= 90 ? 'emerald' : successRate >= 70 ? 'amber' : 'red'}
          hint="אחוז הפוסטים שעלו בהצלחה מתוך הסה״כ."
          trend={[Math.max(0, successRate - 10), successRate - 5, successRate - 2, successRate]}
        />
        <StatCard
          label="משימות בתור"
          value={pendingJobs}
          tone={pendingJobs > 50 ? 'amber' : 'slate'}
          hint="משימות שמחכות לפרסום בקמפיינים פעילים."
        />
      </div>

      {/* Row 2: Active campaign(s) */}
      {activeCampaigns.length > 0 && (
        <section className="space-y-3" aria-label="קמפיינים פעילים">
          {activeCampaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              onPause={handlePause}
              onResume={handleResume}
              busy={busyCampaign === c.id}
            />
          ))}
        </section>
      )}

      {/* Row 3: Activity / Hourly / Safety */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>פעילות חיה</CardTitle>
            <CardDescription>מתעדכן בזמן אמת ככל שהמערכת עובדת.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityFeed events={liveEvents} limit={50} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>פעילות לפי שעה</CardTitle>
            <CardDescription>24 השעות האחרונות, פורסם מול נכשל.</CardDescription>
          </CardHeader>
          <CardContent>
            <HourlyChart buckets={hourlyBuckets} />
            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-4">
              <DonutChart success={successCount} failed={failCount} size={80} thickness={9} />
              <div className="text-xs text-slate-600 leading-relaxed">
                <div className="font-semibold text-slate-800 text-sm">סיכום קצר</div>
                <div className="mt-1">
                  <span className="tabular-nums font-medium">{successCount}</span> הצלחות,{' '}
                  <span className="tabular-nums font-medium">{failCount}</span> כשלים.
                </div>
                <div className="text-slate-500 mt-0.5">מתוך כל הקמפיינים שלך.</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <SafetyIndicator
          className="lg:col-span-1"
          withinHours={withinHours}
          workHoursStart={workStart}
          workHoursEnd={workEnd}
          underDailyCap={underDailyCap}
          todayCount={todayCount}
          dailyCap={dailyCap}
          fbConnected={!!data.fb_connected}
          fbUserName={data.fb_user_name}
        />
      </div>

      {/* Row 4: Quick actions */}
      <QuickActions />
    </div>
  );
}

function DashboardHeader() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">לוח בקרה</h1>
        <p className="text-sm text-slate-500 mt-0.5">תמונת מצב חיה של המערכת.</p>
      </div>
      <div className="text-xs text-slate-500 inline-flex items-center gap-1.5">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        בזמן אמת
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4 space-y-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="p-5 space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
