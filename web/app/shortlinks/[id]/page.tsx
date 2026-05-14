'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { toast } from '@/lib/toast';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  ArrowRight,
  Copy,
  Check,
  ExternalLink,
  TrendingUp,
  MousePointer,
  Users,
} from '@/lib/icons';

interface DrilldownData {
  shortlink: {
    id: string;
    slug: string;
    url: string;
    target_url: string;
    label: string | null;
    is_active: boolean;
    created_at: string;
  };
  totals: {
    totalClicks: number;
    uniqueClickers: number;
    botClicks: number;
    childrenCount: number;
    groupsReached: number;
  };
  per_group: Array<{
    group_id: string | null;
    group_name: string | null;
    group_url: string | null;
    child_slug: string | null;
    posts_count: number;
    total_clicks: number;
    unique_clickers: number;
    bot_clicks: number;
  }>;
  recent_clicks: Array<{
    clicked_at: string;
    is_bot: boolean;
    device_type: string | null;
    country: string | null;
    referrer: string | null;
    group_name: string | null;
  }>;
}

export default function ShortlinkDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<DrilldownData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const d = await apiGet<DrilldownData>(`/api/shortlinks/${id}`);
      setData(d);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg ?? 'שגיאה בטעינת הקישור');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function copyShort() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.shortlink.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('לא הצלחנו להעתיק');
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} padded><Skeleton className="h-12" /></Card>
          ))}
        </div>
        <Card padded><Skeleton className="h-48" /></Card>
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        title="הקישור לא נמצא"
        description="ייתכן שהוא נמחק או שאין לך הרשאה לראותו."
        action={<Link href="/shortlinks"><Button>חזרה לרשימה</Button></Link>}
      />
    );
  }

  const { shortlink, totals, per_group, recent_clicks } = data;
  const ctrTotal = totals.totalClicks + totals.botClicks;

  // The biggest contributor (top group) — surface it as a "headline insight".
  const topGroup = per_group.find((g) => g.group_name && g.total_clicks > 0);
  const topShare = totals.totalClicks > 0 && topGroup
    ? Math.round((topGroup.total_clicks / totals.totalClicks) * 100)
    : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link href="/shortlinks" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
            <ArrowRight size={14} /> כל הקישורים
          </Link>
          <h1 className="text-2xl font-bold tracking-tight truncate">
            {shortlink.label || shortlink.target_url}
          </h1>
          <a
            href={shortlink.target_url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-muted-foreground hover:text-brand-600 inline-flex items-center gap-1 mt-1 break-all"
          >
            {shortlink.target_url}
            <ExternalLink size={12} />
          </a>
        </div>
        <Card padded className="min-w-[280px]">
          <div className="text-xs font-medium text-muted-foreground mb-1">קישור קצר</div>
          <div className="flex items-center gap-2">
            <code dir="ltr" className="text-sm font-mono flex-1 truncate">
              {shortlink.url.replace(/^https?:\/\//, '')}
            </code>
            <Tooltip content="העתק">
              <button
                onClick={copyShort}
                className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground hover:text-foreground"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </Tooltip>
          </div>
        </Card>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<MousePointer size={16} />}
          label="לחיצות (אנשים)"
          value={totals.totalClicks.toLocaleString()}
          hint={totals.botClicks > 0 ? `+${totals.botClicks} bots` : undefined}
        />
        <KpiCard
          icon={<Users size={16} />}
          label="גולשים ייחודיים"
          value={totals.uniqueClickers.toLocaleString()}
          hint={ctrTotal > 0 ? `${Math.round((totals.uniqueClickers / Math.max(totals.totalClicks, 1)) * 100)}% רענן` : undefined}
        />
        <KpiCard
          icon={<TrendingUp size={16} />}
          label="קבוצות הגיעו"
          value={totals.groupsReached.toLocaleString()}
        />
        <KpiCard
          icon={<TrendingUp size={16} />}
          label="פוסטים ברשת"
          value={totals.childrenCount.toLocaleString()}
          hint={totals.childrenCount === 0 ? 'עוד לא בקמפיין' : undefined}
        />
      </div>

      {/* Headline insight */}
      {topGroup && topGroup.total_clicks > 0 && (
        <Card padded className="bg-brand-50 dark:bg-brand-950/30 border-brand-200/50 dark:border-brand-900/50">
          <div className="text-sm">
            <span className="text-muted-foreground">הקבוצה הכי חזקה: </span>
            <span className="font-semibold">{topGroup.group_name}</span>
            <span className="text-muted-foreground"> הביאה </span>
            <span className="font-semibold">{topGroup.total_clicks.toLocaleString()} לחיצות</span>
            <span className="text-muted-foreground"> ({topShare}% מסך הלחיצות).</span>
          </div>
        </Card>
      )}

      {/* Per-group table — the headline feature */}
      <Card padded={false} className="overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-semibold">מאיזה קבוצה הגיעו הלחיצות</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              לכל קבוצה יש סלאג ייחודי — ככה אנחנו יודעים מי הביא מה.
            </p>
          </div>
        </div>
        {per_group.length === 0 ? (
          <div className="py-12 px-4">
            <EmptyState
              title="עוד לא נמדד טראפיק"
              description="ברגע שתפרסם קמפיין שמשתמש בקישור הזה, תראה כאן פירוק לפי קבוצה."
            />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted-foreground">
              <tr>
                <th className="text-start px-4 py-2.5 font-medium">קבוצה</th>
                <th className="text-start px-4 py-2.5 font-medium">פוסטים</th>
                <th className="text-start px-4 py-2.5 font-medium">לחיצות</th>
                <th className="text-start px-4 py-2.5 font-medium">ייחודי</th>
                <th className="text-start px-4 py-2.5 font-medium">% מסה"כ</th>
                <th className="text-start px-4 py-2.5 font-medium w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {per_group.map((g, i) => {
                const share =
                  totals.totalClicks > 0
                    ? (g.total_clicks / totals.totalClicks) * 100
                    : 0;
                return (
                  <tr key={`${g.group_id ?? 'none'}-${i}`} className="hover:bg-surface-2/40">
                    <td className="px-4 py-2.5">
                      <div className="font-medium truncate max-w-[260px]">
                        {g.group_name ? (
                          g.group_url ? (
                            <a
                              href={g.group_url}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:text-brand-600 hover:underline"
                            >
                              {g.group_name}
                            </a>
                          ) : (
                            g.group_name
                          )
                        ) : g.group_url ? (
                          // Group has no `name` set (most rows in production are
                          // like this — the group was added by URL without a
                          // friendly name). Extract a useful identifier from
                          // the URL instead of falsely showing "deleted".
                          (() => {
                            const m = g.group_url.match(
                              /facebook\.com\/groups\/([^/?#]+)/i,
                            );
                            const ident = m?.[1] ?? g.group_url;
                            return (
                              <a
                                href={g.group_url}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:text-brand-600 hover:underline"
                              >
                                {/^\d+$/.test(ident) ? `קבוצה #${ident}` : ident}
                              </a>
                            );
                          })()
                        ) : (
                          <span className="text-muted-foreground italic">קבוצה נמחקה</span>
                        )}
                      </div>
                      {g.child_slug && (
                        <code className="text-[11px] font-mono text-muted-foreground">
                          /l/{g.child_slug}
                        </code>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-foreground/80">{g.posts_count}</td>
                    <td className="px-4 py-2.5 font-semibold">
                      {g.total_clicks.toLocaleString()}
                      {g.bot_clicks > 0 && (
                        <span className="text-[11px] text-muted-foreground font-normal mr-1">
                          (+{g.bot_clicks} bots)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-foreground/80">{g.unique_clickers}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden max-w-[120px]">
                          <div
                            className="h-full bg-brand-500 rounded-full"
                            style={{ width: `${share}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {share.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {g.group_url && (
                        <a
                          href={g.group_url}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground hover:text-foreground inline-block"
                          aria-label="פתח קבוצה"
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Recent clicks */}
      <Card padded={false} className="overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-semibold">לחיצות אחרונות</h2>
        </div>
        {recent_clicks.length === 0 ? (
          <div className="py-12 px-4 text-sm text-muted-foreground text-center">
            אין עדיין לחיצות. ברגע שמישהו ילחץ — תראה אותו כאן בזמן אמת.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted-foreground">
              <tr>
                <th className="text-start px-4 py-2.5 font-medium">מתי</th>
                <th className="text-start px-4 py-2.5 font-medium">קבוצה</th>
                <th className="text-start px-4 py-2.5 font-medium">מכשיר</th>
                <th className="text-start px-4 py-2.5 font-medium">מדינה</th>
                <th className="text-start px-4 py-2.5 font-medium">סוג</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recent_clicks.map((c, i) => (
                <tr key={i} className={c.is_bot ? 'opacity-60' : ''}>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {formatRelative(c.clicked_at)}
                  </td>
                  <td className="px-4 py-2 truncate max-w-[200px]">
                    {c.group_name || <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {c.device_type ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {c.country ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {c.is_bot ? (
                      <span className="text-muted-foreground">bot</span>
                    ) : (
                      <span className="text-brand-600">אדם</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card padded>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold tracking-tight mt-1">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </Card>
  );
}
