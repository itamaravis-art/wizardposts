'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiDelete } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { toast } from '@/lib/toast';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Dialog } from '@/components/ui/Dialog';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  Plus,
  Trash,
  Search,
  Link2,
  Copy,
  ExternalLink,
  TrendingUp,
} from '@/lib/icons';

interface ShortlinkListRow {
  id: string;
  slug: string;
  url: string;
  target_url: string;
  label: string | null;
  is_active: boolean;
  click_count: number;
  bot_click_count: number;
  campaign_count: number;
  created_at: string;
}

export default function ShortlinksPage() {
  const [rows, setRows] = useState<ShortlinkListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await apiGet<ShortlinkListRow[]>('/api/shortlinks');
      setRows(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg ?? 'שגיאה בטעינת הקישורים');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.slug.toLowerCase().includes(s) ||
        r.target_url.toLowerCase().includes(s) ||
        (r.label && r.label.toLowerCase().includes(s)),
    );
  }, [rows, search]);

  async function copyToClipboard(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('הקישור הועתק');
    } catch {
      toast.error('לא הצלחנו להעתיק. סמן וקופי ידנית.');
    }
  }

  async function doDelete(id: string) {
    setDeleting(true);
    try {
      await apiDelete(`/api/shortlinks/${id}`);
      toast.success('הקישור הושבת');
      setConfirmId(null);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg ?? 'מחיקה נכשלה');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">קישורים מקוצרים</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            צור קישור קצר אחד והדבק בפוסטים. נדע מאיזה קבוצה הגיעה כל לחיצה.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-60">
            <Search
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי תווית או יעד"
              className="pr-9"
            />
          </div>
          <Link href="/shortlinks/new">
            <Button icon={<Plus size={16} />}>קישור חדש</Button>
          </Link>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} padded>
              <Skeleton className="h-5 w-1/3 mb-2" />
              <Skeleton className="h-4 w-2/3" />
            </Card>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Link2 size={28} />}
          title="אין עדיין קישורים מקוצרים"
          description="צור קישור קצר אחד, הדבק אותו בפוסטים שלך, ותוכל לראות מאיזה קבוצה הגיעה כל לחיצה."
          action={
            <Link href="/shortlinks/new">
              <Button icon={<Plus size={16} />}>צור קישור ראשון</Button>
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={28} />}
          title="לא נמצאו קישורים תואמים"
          description={`אין קישור עם הטקסט "${search}".`}
          action={
            <Button variant="secondary" onClick={() => setSearch('')}>
              נקה חיפוש
            </Button>
          }
        />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted-foreground">
              <tr>
                <th className="text-start px-4 py-3 font-medium">תווית / יעד</th>
                <th className="text-start px-4 py-3 font-medium">קישור קצר</th>
                <th className="text-start px-4 py-3 font-medium">לחיצות</th>
                <th className="text-start px-4 py-3 font-medium">קמפיינים</th>
                <th className="text-start px-4 py-3 font-medium">נוצר</th>
                <th className="text-start px-4 py-3 font-medium w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2/40 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      href={`/shortlinks/${r.id}`}
                      className="block group"
                    >
                      <div className="font-medium text-foreground truncate max-w-[280px] group-hover:text-brand-600 transition-colors">
                        {r.label || r.target_url}
                      </div>
                      {r.label && (
                        <div className="text-xs text-muted-foreground truncate max-w-[280px] mt-0.5">
                          {r.target_url}
                        </div>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <code className="text-xs font-mono text-foreground/80 bg-surface-2 px-2 py-1 rounded">
                        {r.url.replace(/^https?:\/\//, '')}
                      </code>
                      <Tooltip content="העתק">
                        <button
                          onClick={() => copyToClipboard(r.url)}
                          className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground hover:text-foreground"
                          aria-label="העתק"
                        >
                          <Copy size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip content="פתח את היעד">
                        <a
                          href={r.target_url}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded hover:bg-surface-2 text-muted-foreground hover:text-foreground"
                          aria-label="פתח"
                        >
                          <ExternalLink size={14} />
                        </a>
                      </Tooltip>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 font-medium">
                      <TrendingUp size={14} className="text-brand-500" />
                      {r.click_count.toLocaleString()}
                    </div>
                    {r.bot_click_count > 0 && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        +{r.bot_click_count} bots
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground/80">
                    {r.campaign_count > 0 ? r.campaign_count : '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {formatRelative(r.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <Tooltip content="השבת">
                      <button
                        onClick={() => setConfirmId(r.id)}
                        className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-muted-foreground hover:text-red-600"
                        aria-label="השבת קישור"
                      >
                        <Trash size={14} />
                      </button>
                    </Tooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        title="להשבית את הקישור?"
        description="הקישור יפסיק לעבוד מיד. הסטטיסטיקה הקיימת תישמר. לא ניתן להפעיל שוב מתוך הממשק כרגע."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmId(null)}>
              ביטול
            </Button>
            <Button
              variant="danger"
              onClick={() => confirmId && doDelete(confirmId)}
              disabled={deleting}
            >
              {deleting ? 'משבית…' : 'השבת'}
            </Button>
          </>
        }
      />
    </div>
  );
}
