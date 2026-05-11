'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiUpload } from '@/lib/api';
import { cn } from '@/lib/cn';

import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';
import { Tooltip } from '@/components/ui/Tooltip';

import { toast } from '@/lib/toast';
import {
  ArrowRight,
  Image as ImageIcon,
  X,
  AlertCircle,
  Send,
} from '@/lib/icons';

const MAX_TEXT = 5000;
const MAX_IMG_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB — matches server route
const ALLOWED_IMAGE_RE = /^image\//i;
const ALLOWED_VIDEO_RE = /^video\/(mp4|quicktime|webm|x-m4v)$/i;

/**
 * Expand a single {a|b|c} token into its first variant. We don't fully expand
 * combinations — just give a representative preview so the user knows it's wired.
 */
function previewVariations(text: string): string {
  return text.replace(/\{([^{}]+)\}/g, (_, body) => {
    const parts = String(body).split('|');
    return parts[0] ?? '';
  });
}

function countVariations(text: string): number {
  const matches = text.match(/\{[^{}]+\}/g) ?? [];
  if (!matches.length) return 1;
  return matches.reduce((acc, m) => {
    const inner = m.slice(1, -1);
    const parts = inner.split('|').filter(Boolean);
    return acc * Math.max(parts.length, 1);
  }, 1);
}

export default function NewPostPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ text?: string; image?: string }>({});
  const [dragOver, setDragOver] = useState(false);

  // Sync image preview URL
  useEffect(() => {
    if (!file) {
      setImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const variationCount = useMemo(() => countVariations(text), [text]);
  const previewText = useMemo(() => previewVariations(text), [text]);

  function handleFile(f: File | null) {
    if (!f) {
      setFile(null);
      return;
    }
    const isImage = ALLOWED_IMAGE_RE.test(f.type);
    const isVideo = ALLOWED_VIDEO_RE.test(f.type);
    if (!isImage && !isVideo) {
      setErrors((e) => ({ ...e, image: 'יש לבחור קובץ תמונה (JPG/PNG/WEBP) או וידאו (MP4/MOV/WEBM)' }));
      return;
    }
    const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMG_BYTES;
    if (f.size > limit) {
      const mb = Math.round(limit / 1024 / 1024);
      setErrors((e) => ({
        ...e,
        image: isVideo ? `הוידאו גדול מדי (מקסימום ${mb}MB)` : `התמונה גדולה מדי (מקסימום ${mb}MB)`,
      }));
      return;
    }
    setErrors((e) => ({ ...e, image: undefined }));
    setFile(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  function validate(): boolean {
    const next: { text?: string; image?: string } = {};
    if (!text.trim()) next.text = 'יש להזין טקסט לפוסט';
    else if (text.length > MAX_TEXT) next.text = `הטקסט ארוך מדי (מקסימום ${MAX_TEXT})`;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);

    const fd = new FormData();
    fd.append('text', text);
    if (file) {
      // Server accepts either 'image' or 'video' field name — pick by
      // MIME so the right validation + bucket are used.
      const fieldName = ALLOWED_VIDEO_RE.test(file.type) ? 'video' : 'image';
      fd.append(fieldName, file);
    }

    try {
      await toast.promise(apiUpload('/api/posts', fd), {
        loading: 'שומר את הפוסט...',
        success: 'הפוסט נוצר',
        error: (e) => (e instanceof Error ? e.message : 'שגיאה ביצירת הפוסט'),
      });
      router.push('/posts');
    } catch {
      // toast already shown
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowRight size={16} />}
          onClick={() => router.back()}
          aria-label="חזרה"
        />
        <div>
          <h1 className="text-2xl font-bold">פוסט חדש</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            הוסף תוכן ותמונה — נשמור הכל בספרייה לשימוש בקמפיינים.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Form column (right in RTL = visually first child) */}
        <Card padded className="space-y-4 order-2 lg:order-1">
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <label htmlFor="post-text" className="text-sm font-medium">
                טקסט הפוסט
              </label>
              <Tooltip content="אפשר להוסיף וריאציות עם {א|ב|ג} — בכל פרסום ייבחר אקראית. למשל: שלום {חברים|חברות}!">
                <span className="text-xs text-brand-700 dark:text-brand-300 cursor-help underline decoration-dotted">
                  וריאציות?
                </span>
              </Tooltip>
            </div>
            <Textarea
              id="post-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              dir="rtl"
              placeholder="כתוב את תוכן הפוסט כאן..."
              error={errors.text}
              maxLength={MAX_TEXT}
            />
            <div className="flex justify-between items-center mt-1.5 text-xs">
              <div className="text-slate-500">
                {variationCount > 1 ? (
                  <span className="text-brand-700 dark:text-brand-300">
                    {variationCount} וריאציות אפשריות
                  </span>
                ) : (
                  <span>טיפ: {`{שלום|היי} עולם`} ייצור 2 וריאציות</span>
                )}
              </div>
              <div
                className={cn(
                  'tabular-nums text-slate-500',
                  text.length > MAX_TEXT * 0.9 && 'text-amber-600',
                  text.length >= MAX_TEXT && 'text-red-600 font-semibold'
                )}
              >
                {text.length} / {MAX_TEXT}
              </div>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5">
              תמונה <span className="text-slate-400">(אופציונלי)</span>
            </label>
            <div
              ref={dropRef}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className={cn(
                'relative cursor-pointer rounded-xl border-2 border-dashed transition-colors',
                'flex flex-col items-center justify-center text-center px-4 py-8',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                dragOver
                  ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/20'
                  : 'border-slate-300 dark:border-border hover:border-brand-400 hover:bg-slate-50 dark:hover:bg-surface-2'
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime,video/webm,video/x-m4v"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <div className="text-slate-400 mb-2">
                <ImageIcon size={28} />
              </div>
              <div className="text-sm font-medium text-slate-700 dark:text-foreground">
                גרור תמונה או וידאו לכאן או לחץ לבחירה
              </div>
              <div className="text-xs text-slate-500 mt-1">
                תמונה (JPG / PNG / WEBP · עד 8MB) או וידאו (MP4 / MOV / WEBM · עד 100MB)
              </div>
            </div>
            {errors.image && (
              <div className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
                <AlertCircle size={12} />
                {errors.image}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-border">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.back()}
              disabled={submitting}
            >
              ביטול
            </Button>
            <Button type="submit" loading={submitting} icon={<Send size={16} />}>
              צור פוסט
            </Button>
          </div>
        </Card>

        {/* Preview column */}
        <div className="order-1 lg:order-2">
          <div className="lg:sticky lg:top-4">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>תצוגה מקדימה</CardTitle>
                <CardDescription>כך הפוסט עשוי להיראות בפיד</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl border border-slate-200 dark:border-border overflow-hidden bg-white dark:bg-surface">
                  {/* Mock FB header */}
                  <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 dark:border-border">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">
                        העמוד שלך
                      </div>
                      <div className="text-[11px] text-slate-500">לפני רגע · 🌍</div>
                    </div>
                  </div>

                  <div className="px-3 py-2.5">
                    <div className="text-sm whitespace-pre-wrap break-words min-h-[3rem] text-slate-800 dark:text-foreground leading-relaxed">
                      {previewText || (
                        <span className="text-slate-400">
                          הטקסט יופיע כאן בזמן אמת...
                        </span>
                      )}
                    </div>
                  </div>

                  {imagePreview ? (
                    <div className="relative bg-slate-100 dark:bg-surface-2">
                      {file && ALLOWED_VIDEO_RE.test(file.type) ? (
                        <video
                          src={imagePreview}
                          controls
                          className="w-full max-h-80 object-contain bg-black"
                        />
                      ) : (
                        <img
                          src={imagePreview}
                          alt="תצוגה"
                          className="w-full max-h-80 object-contain"
                        />
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="absolute top-2 left-2 bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        aria-label="הסר קובץ"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : null}

                  <div className="px-3 py-2 border-t border-slate-100 dark:border-border flex items-center gap-3 text-xs text-slate-400">
                    <span>👍 לייק</span>
                    <span>💬 תגובה</span>
                    <span>↗ שיתוף</span>
                  </div>
                </div>

                {variationCount > 1 && (
                  <div className="mt-3 text-xs text-slate-500 flex items-start gap-1.5">
                    <span className="text-brand-600 dark:text-brand-400 mt-0.5">●</span>
                    <span>
                      התצוגה היא וריאציה אחת מתוך <strong>{variationCount}</strong>.
                      בכל פרסום ייבחר שילוב אקראי.
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
