'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPost } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { toast } from '@/lib/toast';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import {
  Inbox,
  Check,
  X,
  Settings,
  Image as ImageIcon,
} from '@/lib/icons';

interface QueuePost {
  id: string;
  pageId: string | null;
  text: string;
  imageUrl: string | null;
  imagePrompt: string | null;
  captionVariants: string[] | null;
  approvalStatus: string | null;
  scheduledAt: string | null;
  retryCount: number;
}

export default function PageQueueView() {
  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');

  async function load() {
    setLoading(true);
    try {
      const data = await apiGet<QueuePost[]>(`/api/page/posts?status=${tab}`);
      setPosts(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg ?? 'שגיאה בטעינת התור');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">תור אישורים — פוסטי דף</h1>
          <p className="text-sm text-muted-foreground mt-1">
            פוסטים שיוצרו על ידי AI ומחכים לאישור שלך לפני פרסום ב-Facebook Page.
            פוסט שלא יאושר עד 09:30 — ידולג אוטומטית.
          </p>
        </div>
        <Link href="/page/connect">
          <Button variant="ghost" icon={<Settings size={16} />}>
            הדפים שלי
          </Button>
        </Link>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'pending' | 'history')}>
        <TabsList>
          <TabsTrigger value="pending">ממתינים לאישור</TabsTrigger>
          <TabsTrigger value="history">היסטוריה</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} padded><Skeleton className="h-64" /></Card>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<Inbox size={28} />}
          title={tab === 'pending' ? 'אין פוסטים ממתינים' : 'עדיין אין היסטוריה'}
          description={
            tab === 'pending'
              ? 'כשה-AI ייצור פוסטים חדשים (כל יום ב-22:00 לפני יום הפרסום), הם יופיעו כאן.'
              : 'פוסטים שאושרו / נדחו / פורסמו / דולגו יופיעו כאן.'
          }
        />
      ) : (
        <div className="space-y-4">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} onChange={load} readOnly={tab === 'history'} />
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({
  post,
  onChange,
  readOnly,
}: {
  post: QueuePost;
  onChange: () => void;
  readOnly: boolean;
}) {
  const variants = post.captionVariants ?? [post.text];
  const initialIdx = Math.max(
    0,
    variants.findIndex((v) => v === post.text),
  );
  const [selectedIdx, setSelectedIdx] = useState<number>(initialIdx === -1 ? 0 : initialIdx);
  const [text, setText] = useState(post.text);
  const [busy, setBusy] = useState<null | 'approve' | 'reject' | 'cap' | 'img'>(null);

  function pickVariant(i: number) {
    setSelectedIdx(i);
    if (variants[i]) setText(variants[i]!);
  }

  async function approve() {
    setBusy('approve');
    try {
      await apiPost(`/api/page/posts/${post.id}/approve`, {
        selectedVariantIndex: selectedIdx,
        finalCaption: text,
      });
      toast.success('הפוסט אושר ויפורסם בזמן המתוזמן');
      onChange();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy('reject');
    try {
      await apiPost(`/api/page/posts/${post.id}/reject`, {});
      toast.success('הפוסט נדחה');
      onChange();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function regenerateCaption() {
    setBusy('cap');
    try {
      const res = await apiPost<{ captionVariants: string[]; text: string }>(
        `/api/page/posts/${post.id}/regenerate-caption`,
        {},
      );
      setText(res.text);
      setSelectedIdx(0);
      toast.success('יוצרו וריאציות חדשות');
      onChange();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function regenerateImage() {
    setBusy('img');
    try {
      await apiPost(`/api/page/posts/${post.id}/regenerate-image`, {});
      toast.success('תמונה חדשה נוצרה');
      onChange();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const statusBadge = (() => {
    switch (post.approvalStatus) {
      case 'pending':
        return <Badge variant="warning">ממתין</Badge>;
      case 'approved':
        return <Badge variant="brand">מאושר</Badge>;
      case 'rejected':
        return <Badge variant="neutral">נדחה</Badge>;
      case 'skipped':
        return <Badge variant="neutral">דולג</Badge>;
      case 'published':
        return <Badge variant="success">פורסם</Badge>;
      case 'failed':
        return <Badge variant="danger">נכשל</Badge>;
      default:
        return null;
    }
  })();

  return (
    <Card padded={false} className="overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          {statusBadge}
          {post.scheduledAt && (
            <span className="text-xs text-muted-foreground">
              מתוזמן ל-{new Date(post.scheduledAt).toLocaleString('he-IL', {
                weekday: 'short',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
          {post.retryCount > 0 && (
            <Badge variant="warning">retries: {post.retryCount}</Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{formatRelative(post.scheduledAt ?? new Date().toISOString())}</span>
      </div>

      {/* Body — Facebook-ish preview */}
      <div className="grid md:grid-cols-2 gap-0">
        <div className="bg-surface-2 p-4 flex items-center justify-center">
          {post.imageUrl ? (
            <img
              src={post.imageUrl}
              alt=""
              className="rounded-lg max-h-[420px] object-contain shadow-md"
            />
          ) : (
            <div className="w-full aspect-square max-w-md flex items-center justify-center bg-surface text-muted-foreground rounded-lg">
              <ImageIcon size={36} />
            </div>
          )}
        </div>

        <div className="p-4 space-y-3">
          {/* Variant tabs */}
          {variants.length > 1 && !readOnly && (
            <div className="flex gap-1.5">
              {variants.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickVariant(i)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    i === selectedIdx
                      ? 'bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300 font-medium'
                      : 'bg-surface-2 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  גרסה {i + 1}
                </button>
              ))}
            </div>
          )}

          {/* Caption editor / display */}
          {readOnly ? (
            <div className="text-sm whitespace-pre-wrap leading-relaxed bg-surface-2 p-3 rounded-md min-h-[180px]">
              {post.text}
            </div>
          ) : (
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={9}
              maxLength={5000}
              className="resize-y"
            />
          )}

          {/* Action buttons */}
          {!readOnly && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={regenerateCaption}
                  disabled={busy !== null}
                >
                  {busy === 'cap' ? 'יוצר…' : '🔄 חדש טקסט'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={regenerateImage}
                  disabled={busy !== null}
                >
                  {busy === 'img' ? 'יוצר…' : '🖼️ חדש תמונה'}
                </Button>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  variant="ghost"
                  onClick={reject}
                  disabled={busy !== null}
                  icon={<X size={14} />}
                >
                  {busy === 'reject' ? 'דוחה…' : 'דחה'}
                </Button>
                <Button
                  onClick={approve}
                  disabled={busy !== null || text.trim().length === 0}
                  icon={<Check size={14} />}
                >
                  {busy === 'approve' ? 'מאשר…' : 'אשר ופרסם בזמן'}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
