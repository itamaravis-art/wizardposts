'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiGet, apiDelete } from '@/lib/api';
import type { Post, ID } from '@/lib/types';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Dialog } from '@/components/ui/Dialog';
import { Tooltip } from '@/components/ui/Tooltip';

import { toast } from '@/lib/toast';
import {
  Plus,
  Trash,
  Search,
  Image as ImageIcon,
  Send,
  Eye,
} from '@/lib/icons';

function imageSrc(p: { imageUrl?: string | null; image_path?: string | null } | null | undefined): string | null {
  if (!p) return null;
  // Cloud version: imageUrl is a full Supabase public URL.
  if (p.imageUrl) return p.imageUrl;
  // Backwards-compat with local naming (image_path).
  if (p.image_path) {
    const base = p.image_path.split(/[/\\]/).pop();
    return base ? `/images/${base}` : null;
  }
  return null;
}

export default function PostsPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [confirmId, setConfirmId] = useState<ID | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewPost, setPreviewPost] = useState<Post | null>(null);

  async function load(showSkeleton = true) {
    if (showSkeleton) setLoading(true);
    try {
      const data = await apiGet<Post[]>('/api/posts');
      setPosts(data);
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה בטעינת הפוסטים');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return posts;
    const s = search.toLowerCase();
    return posts.filter((p) => p.text.toLowerCase().includes(s));
  }, [posts, search]);

  async function doDelete(id: ID) {
    setDeleting(true);
    try {
      await apiDelete(`/api/posts/${id}`);
      toast.success('הפוסט נמחק');
      setConfirmId(null);
      // optimistic local remove + refresh
      setPosts((prev) => prev.filter((p) => p.id !== id));
      load(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה במחיקה');
    } finally {
      setDeleting(false);
    }
  }

  function useInCampaign(p: Post) {
    router.push(`/campaigns/new?post_id=${p.id}`);
  }

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold">פוסטים</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            ספריית הפוסטים שלך — ניתן להשתמש בהם בקמפיינים.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-1 sm:flex-none sm:min-w-[24rem]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש בטקסט הפוסטים..."
            icon={<Search size={16} />}
            className="flex-1"
          />
          <Link href="/posts/new">
            <Button icon={<Plus size={16} />}>פוסט חדש</Button>
          </Link>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} padded className="space-y-3">
              <Skeleton className="h-40 w-full rounded-lg" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-full" />
            </Card>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<ImageIcon size={28} />}
          title="עדיין לא יצרת פוסטים"
          description="פוסט הוא תוכן שניתן לשגר לקבוצות בקמפיין. אפשר להתחיל מאחד פשוט עם טקסט ותמונה."
          action={
            <Link href="/posts/new">
              <Button icon={<Plus size={16} />}>צור פוסט ראשון</Button>
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={28} />}
          title="לא נמצאו פוסטים תואמים"
          description={`אין פוסט עם הטקסט "${search}". נסה ביטוי אחר.`}
          action={<Button variant="secondary" onClick={() => setSearch('')}>נקה חיפוש</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => {
            const src = imageSrc(p);
            return (
              <Card
                key={p.id}
                hoverLift
                className="group flex flex-col overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setPreviewPost(p)}
                  className="block w-full text-right focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                  aria-label="הצג תצוגה מקדימה"
                >
                  {src ? (
                    <div className="relative h-40 bg-slate-100 overflow-hidden">
                      <img
                        src={src}
                        alt=""
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    </div>
                  ) : (
                    <div className="h-40 bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center text-slate-300">
                      <ImageIcon size={36} />
                    </div>
                  )}
                </button>

                <div className="p-4 flex flex-col flex-1">
                  <p className="text-sm text-slate-800 dark:text-foreground line-clamp-3 whitespace-pre-wrap flex-1 leading-relaxed">
                    {p.text}
                  </p>

                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100 dark:border-border text-xs text-slate-500">
                    <span>{formatRelative(p.created_at)}</span>
                    <span>{p.text.length} תווים</span>
                  </div>

                  <div className="flex items-center gap-2 mt-3">
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Send size={14} />}
                      onClick={() => useInCampaign(p)}
                      className="flex-1"
                    >
                      בקמפיין
                    </Button>
                    <Tooltip content="תצוגה מקדימה">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Eye size={14} />}
                        onClick={() => setPreviewPost(p)}
                        aria-label="תצוגה מקדימה"
                      />
                    </Tooltip>
                    <Tooltip content="מחק פוסט">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash size={14} />}
                        onClick={() => setConfirmId(p.id)}
                        className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        aria-label="מחק"
                      />
                    </Tooltip>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete confirm */}
      <Dialog
        open={confirmId !== null}
        onClose={() => !deleting && setConfirmId(null)}
        title="מחיקת פוסט"
        description="פעולה זו אינה הפיכה. אם הפוסט בשימוש בקמפיין פעיל הוא יוסר ממנו."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmId(null)}
              disabled={deleting}
            >
              ביטול
            </Button>
            <Button
              variant="danger"
              icon={<Trash size={16} />}
              loading={deleting}
              onClick={() => confirmId && doDelete(confirmId)}
            >
              מחק
            </Button>
          </>
        }
      />

      {/* Preview */}
      <Dialog
        open={previewPost !== null}
        onClose={() => setPreviewPost(null)}
        title="תצוגת פוסט"
        size="lg"
      >
        {previewPost && (
          <div className="space-y-3">
            {imageSrc(previewPost) && (
              <img
                src={imageSrc(previewPost)!}
                alt=""
                className="w-full max-h-96 object-contain rounded-lg bg-slate-50"
              />
            )}
            <div className="text-sm text-slate-800 dark:text-foreground whitespace-pre-wrap leading-relaxed bg-slate-50 dark:bg-surface-2 rounded-lg p-3">
              {previewPost.text}
            </div>
            <div className="text-xs text-slate-500">
              {previewPost.text.length} תווים · נוצר {formatRelative(previewPost.created_at)}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setPreviewPost(null)}>
                סגור
              </Button>
              <Button
                icon={<Send size={16} />}
                onClick={() => useInCampaign(previewPost)}
              >
                השתמש בקמפיין
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
