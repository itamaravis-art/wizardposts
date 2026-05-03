'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '@/lib/api';
import type { LogEntry } from '@/lib/types';
import { formatDate, formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

import { toast } from '@/lib/toast';
import { useEvents } from '@/lib/useEvents';
import {
  Search,
  Logs as LogsIcon,
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from '@/lib/icons';

const PAGE_SIZE = 50;

const LEVEL_STYLES: Record<string, { row: string; badge: 'secondary' | 'warning' | 'danger'; icon?: string }> = {
  info: { row: '', badge: 'secondary' },
  warn: {
    row: 'bg-amber-50/50 dark:bg-amber-950/10 border-r-4 border-r-amber-400',
    badge: 'warning',
  },
  error: {
    row: 'bg-red-50/50 dark:bg-red-950/10 border-r-4 border-r-red-500',
    badge: 'danger',
  },
};

function formatMeta(meta: string | null): string {
  if (!meta) return '';
  try {
    return JSON.stringify(JSON.parse(meta), null, 2);
  } catch {
    return meta;
  }
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [level, setLevel] = useState<string>('');
  const [source, setSource] = useState<string>('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

  // Live tail
  const [liveTail, setLiveTail] = useState(true);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { events } = useEvents(['log.added']);
  const seenIds = useRef<Set<number>>(new Set());

  async function load(showSkeleton = false) {
    if (showSkeleton) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (level) params.set('level', level);
      if (source) params.set('source', source);
      const data = await apiGet<LogEntry[]>(`/api/logs?${params.toString()}`);
      setLogs(data);
      seenIds.current = new Set(data.map((l) => l.id));
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה בטעינת היומן');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
    setPage(1);
  }, [level, source]);

  // SSE: prepend new entries when live tail is on
  useEffect(() => {
    if (!liveTail || !events || events.length === 0) return;
    const newest = events[0];
    if (!newest) return;
    const entry = (newest as any).payload as LogEntry | undefined;
    if (!entry || typeof entry !== 'object' || !('id' in entry)) return;
    if (seenIds.current.has(entry.id)) return;
    seenIds.current.add(entry.id);
    setLogs((prev) => [entry, ...prev].slice(0, 500));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events?.[0]?.id, liveTail]);

  const sources = useMemo(() => {
    const s = new Set<string>();
    logs.forEach((l) => s.add(l.source));
    return Array.from(s).sort();
  }, [logs]);

  // Apply client-side filters
  const filtered = useMemo(() => {
    let out = logs;
    if (search.trim()) {
      const s = search.toLowerCase();
      out = out.filter(
        (l) =>
          l.message.toLowerCase().includes(s) ||
          (l.meta ?? '').toLowerCase().includes(s) ||
          l.source.toLowerCase().includes(s)
      );
    }
    if (from) {
      const t = new Date(from).getTime();
      if (!isNaN(t)) out = out.filter((l) => new Date(l.created_at).getTime() >= t);
    }
    if (to) {
      const t = new Date(to).getTime();
      if (!isNaN(t)) out = out.filter((l) => new Date(l.created_at).getTime() <= t);
    }
    return out;
  }, [logs, search, from, to]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  useEffect(() => {
    setPage(1);
  }, [search, from, to]);

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setLevel('');
    setSource('');
    setSearch('');
    setFrom('');
    setTo('');
  }

  const counts = useMemo(() => {
    const c = { info: 0, warn: 0, error: 0 };
    for (const l of filtered) {
      if (l.level in c) (c as any)[l.level]++;
    }
    return c;
  }, [filtered]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold">יומן אירועים</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            כל הפעילות במערכת — מקור אמת לאיתור תקלות.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <Switch
            checked={liveTail}
            onCheckedChange={setLiveTail}
            aria-label="מעקב חי"
          />
          <span className="flex items-center gap-1.5">
            מעקב חי
            {liveTail && (
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </span>
        </label>
      </div>

      {/* Filters */}
      <Card padded className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש בהודעות, meta או מקור..."
            icon={<Search size={16} />}
            className="md:col-span-5"
          />
          <Select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="md:col-span-2"
            aria-label="רמה"
          >
            <option value="">כל הרמות</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </Select>
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="md:col-span-2"
            aria-label="מקור"
          >
            <option value="">כל המקורות</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="md:col-span-3 lg:col-span-2"
            aria-label="מ"
          />
          <Input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="md:col-span-3 lg:col-span-1"
            aria-label="עד"
          />
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2 text-sm">
          <div className="flex items-center gap-2 text-slate-500">
            <span>סה״כ {filtered.length} אירועים</span>
            {counts.error > 0 && (
              <Badge variant="danger">
                {counts.error} שגיאות
              </Badge>
            )}
            {counts.warn > 0 && (
              <Badge variant="warning">
                {counts.warn} אזהרות
              </Badge>
            )}
          </div>
          {(search || level || source || from || to) && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              נקה סינון
            </Button>
          )}
        </div>
      </Card>

      {/* Body */}
      {loading ? (
        <Card padded className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<LogsIcon size={28} />}
          title={logs.length === 0 ? 'אין אירועים עדיין' : 'אין תוצאות לסינון'}
          description={
            logs.length === 0
              ? 'אירועי המערכת יופיעו כאן כשהקמפיין הראשון יופעל.'
              : 'נסה לרכך את הסינון.'
          }
          action={
            logs.length > 0 ? (
              <Button variant="secondary" onClick={clearFilters}>
                נקה סינון
              </Button>
            ) : null
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-surface-2 text-slate-600 dark:text-muted-foreground border-b border-slate-200 dark:border-border">
                <tr>
                  <th className="text-right p-3 font-semibold w-40">זמן</th>
                  <th className="text-right p-3 font-semibold w-24">רמה</th>
                  <th className="text-right p-3 font-semibold w-32">מקור</th>
                  <th className="text-right p-3 font-semibold">הודעה</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((l) => {
                  const style = LEVEL_STYLES[l.level] ?? LEVEL_STYLES.info;
                  const isOpen = expanded.has(l.id);
                  const hasMeta = !!l.meta;
                  return (
                    <tr
                      key={l.id}
                      className={cn(
                        'border-b border-slate-100 dark:border-border last:border-0 align-top transition-colors',
                        style.row,
                        !style.row && 'hover:bg-slate-50 dark:hover:bg-surface-2'
                      )}
                    >
                      <td className="p-3 whitespace-nowrap">
                        <div className="text-xs text-slate-700 dark:text-foreground tabular-nums">
                          {formatDate(l.created_at)}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {formatRelative(l.created_at)}
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant={style.badge}>
                          {l.level === 'error' && (
                            <AlertCircle size={10} className="ml-1" />
                          )}
                          {l.level.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="p-3 font-mono text-xs text-slate-600 dark:text-muted-foreground whitespace-nowrap">
                        {l.source}
                      </td>
                      <td className="p-3">
                        <div className="text-slate-800 dark:text-foreground break-words">
                          {l.message}
                        </div>
                        {hasMeta && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(l.id)}
                            className="inline-flex items-center gap-1 mt-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded"
                            aria-expanded={isOpen}
                          >
                            <ChevronDown
                              size={12}
                              className={cn(
                                'transition-transform',
                                isOpen && 'rotate-180'
                              )}
                            />
                            {isOpen ? 'הסתר meta' : 'הצג meta'}
                          </button>
                        )}
                        {hasMeta && isOpen && (
                          <pre
                            dir="ltr"
                            className="text-xs bg-slate-900 dark:bg-black text-slate-100 rounded p-3 mt-2 overflow-x-auto font-mono"
                          >
                            {formatMeta(l.meta)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-border bg-slate-50 dark:bg-surface-2">
              <span className="text-xs text-slate-500 tabular-nums">
                עמוד {page} מתוך {totalPages} · {filtered.length} אירועים
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ChevronRight size={14} />}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  aria-label="קודם"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ChevronLeft size={14} />}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  aria-label="הבא"
                />
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
