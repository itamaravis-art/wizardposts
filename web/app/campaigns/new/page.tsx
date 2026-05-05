'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiGet, apiPost } from '@/lib/api';
import type { Post, Group, Settings, ID } from '@/lib/types';
import { msToMinutes, minutesToMs } from '@/lib/format';
import { cn } from '@/lib/cn';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Slider } from '@/components/ui/Slider';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tooltip } from '@/components/ui/Tooltip';

import { toast } from '@/lib/toast';
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Plus,
  Search,
  Image as ImageIcon,
  Send,
  Users,
  Settings as SettingsIcon,
  Eye,
  AlertCircle,
} from '@/lib/icons';

type StepId = 'post' | 'groups' | 'settings' | 'review';
const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'post', label: 'שם ופוסט' },
  { id: 'groups', label: 'קבוצות' },
  { id: 'settings', label: 'הגדרות' },
  { id: 'review', label: 'סקירה' },
];

function imageSrc(p: string | null | undefined): string | null {
  if (!p) return null;
  if (/^https?:\/\//.test(p)) return p; // cloud Supabase URL
  const base = p.split(/[/\\]/).pop();
  return base ? `/images/${base}` : null;
}

export default function NewCampaignPageWrapper() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-500">טוען…</div>}>
      <NewCampaignPage />
    </Suspense>
  );
}

function NewCampaignPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetPostId = searchParams.get('post_id');

  const [posts, setPosts] = useState<Post[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // form
  const [step, setStep] = useState<StepId>('post');
  const [name, setName] = useState('');
  // postId may be a string UUID (cloud) or a numeric rowid (legacy local).
  const [postId, setPostId] = useState<ID | null>(presetPostId ?? null);
  const [groupIds, setGroupIds] = useState<Set<ID>>(new Set());
  const [groupSearch, setGroupSearch] = useState('');

  const [dailyCap, setDailyCap] = useState(12);
  const [minDelayMin, setMinDelayMin] = useState(5);
  const [maxDelayMin, setMaxDelayMin] = useState(15);
  const [workStart, setWorkStart] = useState(9);
  const [workEnd, setWorkEnd] = useState(22);
  const [textVariations, setTextVariations] = useState(true);
  // Scheduling: when null/empty -> start immediately. Otherwise -> ISO local datetime
  // string from <input type="datetime-local">.
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(''); // 'YYYY-MM-DDTHH:mm'

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const [p, g, s] = await Promise.all([
          apiGet<Post[]>('/api/posts'),
          apiGet<Group[]>('/api/groups?active=1'),
          apiGet<Settings>('/api/settings'),
        ]);
        setPosts(p);
        setGroups(g);
        setDailyCap(s.daily_cap);
        setMinDelayMin(msToMinutes(s.min_delay_ms));
        setMaxDelayMin(msToMinutes(s.max_delay_ms));
        setWorkStart(s.work_hours_start);
        setWorkEnd(s.work_hours_end);
      } catch (e: any) {
        toast.error(e?.message ?? 'שגיאה בטעינה');
      } finally {
        setLoadingData(false);
      }
    })();
  }, []);

  // Compare IDs as strings — cloud uses UUIDs, legacy used numeric rowids,
  // and URL-derived presetPostId is always a string.
  const selectedPost = useMemo(
    () => posts.find((p) => String(p.id) === String(postId)) ?? null,
    [posts, postId]
  );

  const groupedByTag = useMemo(() => {
    const filtered = groupSearch
      ? groups.filter((g) => {
          const s = groupSearch.toLowerCase();
          return (
            (g.name ?? '').toLowerCase().includes(s) ||
            g.url.toLowerCase().includes(s) ||
            (g.tag ?? '').toLowerCase().includes(s)
          );
        })
      : groups;
    const map = new Map<string, Group[]>();
    for (const g of filtered) {
      const key = g.tag ?? 'ללא תגית';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'he'));
  }, [groups, groupSearch]);

  function toggleGroup(id: ID) {
    setGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function setTagSelected(tag: string, gs: Group[], select: boolean) {
    setGroupIds((prev) => {
      const next = new Set(prev);
      for (const g of gs) {
        if (select) next.add(g.id);
        else next.delete(g.id);
      }
      return next;
    });
  }

  // Schedule preview
  const schedule = useMemo(() => {
    const jobsTotal = groupIds.size;
    if (jobsTotal === 0 || dailyCap === 0) return { days: 0, jobs: 0 };
    const days = Math.ceil(jobsTotal / dailyCap);
    return { days, jobs: jobsTotal };
  }, [groupIds, dailyCap]);

  // Validation per step
  function validateStep(s: StepId): boolean {
    const next: Record<string, string> = {};
    if (s === 'post' || s === 'review') {
      if (!name.trim()) next.name = 'יש להזין שם לקמפיין';
      else if (name.length > 80) next.name = 'השם ארוך מדי (מקסימום 80)';
      if (!postId) next.post = 'יש לבחור פוסט';
    }
    if (s === 'groups' || s === 'review') {
      if (groupIds.size === 0) next.groups = 'יש לבחור לפחות קבוצה אחת';
    }
    if (s === 'settings' || s === 'review') {
      if (minDelayMin > maxDelayMin)
        next.delay = 'השהיה מינימלית חייבת להיות קטנה ממקסימלית';
      if (workStart >= workEnd) next.hours = 'שעת התחלה חייבת להיות קטנה משעת סיום';
      if (dailyCap < 1) next.cap = 'תקרה יומית חייבת להיות לפחות 1';
      if (scheduleEnabled) {
        if (!scheduleAt) {
          next.schedule = 'יש לבחור תאריך ושעה להתחלה';
        } else {
          const t = new Date(scheduleAt).getTime();
          if (Number.isNaN(t)) next.schedule = 'תאריך/שעה לא תקינים';
          else if (t <= Date.now()) next.schedule = 'התאריך/שעה חייבים להיות בעתיד';
        }
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goNext() {
    if (!validateStep(step)) return;
    const idx = STEPS.findIndex((s) => s.id === step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].id);
  }
  function goPrev() {
    const idx = STEPS.findIndex((s) => s.id === step);
    if (idx > 0) setStep(STEPS[idx - 1].id);
  }

  async function submit() {
    // Run full validation
    const ok =
      validateStep('post') && validateStep('groups') && validateStep('settings');
    if (!ok) {
      toast.error('יש שדות שצריכים תיקון');
      return;
    }
    setBusy(true);
    try {
      await toast.promise(
        apiPost('/api/campaigns', {
          name: name.trim(),
          post_id: postId,
          group_ids: Array.from(groupIds),
          daily_cap: dailyCap,
          min_delay_ms: minutesToMs(minDelayMin),
          max_delay_ms: minutesToMs(maxDelayMin),
          work_hours_start: workStart,
          work_hours_end: workEnd,
          text_variations: textVariations,
          // Convert local datetime-local value to ISO UTC.
          scheduled_start_at:
            scheduleEnabled && scheduleAt
              ? new Date(scheduleAt).toISOString()
              : null,
        }),
        {
          loading: 'יוצר קמפיין...',
          success: 'הקמפיין נוצר',
          error: (e) => (e instanceof Error ? e.message : 'שגיאה ביצירה'),
        }
      );
      router.push('/campaigns');
    } catch {
      // toast shown
    } finally {
      setBusy(false);
    }
  }

  // Step header
  const stepIdx = STEPS.findIndex((s) => s.id === step);

  if (loadingData) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-5">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowRight size={16} />}
          onClick={() => router.push('/campaigns')}
          aria-label="חזרה"
        />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">קמפיין חדש</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            ארבעה צעדים — בחירת פוסט, קבוצות, הגדרות, ואישור.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-5">
        {/* Stepper */}
        <Card padded className="lg:sticky lg:top-4 lg:self-start">
          <ol className="space-y-1">
            {STEPS.map((s, i) => {
              const isActive = s.id === step;
              const isPast = i < stepIdx;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      // Allow jumping back to previous steps; forward only if current is valid
                      if (i <= stepIdx || validateStep(step)) setStep(s.id);
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 p-2.5 rounded-lg text-right transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                      isActive
                        ? 'bg-brand-50 dark:bg-brand-950/30 text-brand-800 dark:text-brand-200'
                        : 'text-slate-700 dark:text-foreground hover:bg-slate-50 dark:hover:bg-surface-2'
                    )}
                  >
                    <span
                      className={cn(
                        'shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors',
                        isActive
                          ? 'bg-brand-600 text-white'
                          : isPast
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : 'bg-slate-100 text-slate-500 dark:bg-surface-2'
                      )}
                    >
                      {isPast ? <Check size={14} /> : i + 1}
                    </span>
                    <span className="text-sm font-medium">{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </Card>

        {/* Step content */}
        <div className="min-w-0 space-y-4">
          {step === 'post' && (
            <StepPost
              name={name}
              setName={setName}
              posts={posts}
              postId={postId}
              setPostId={setPostId}
              errors={errors}
            />
          )}
          {step === 'groups' && (
            <StepGroups
              groups={groups}
              groupedByTag={groupedByTag}
              search={groupSearch}
              setSearch={setGroupSearch}
              groupIds={groupIds}
              toggleGroup={toggleGroup}
              setTagSelected={setTagSelected}
              clearAll={() => setGroupIds(new Set())}
              errors={errors}
            />
          )}
          {step === 'settings' && (
            <StepSettings
              dailyCap={dailyCap}
              setDailyCap={setDailyCap}
              minDelayMin={minDelayMin}
              setMinDelayMin={setMinDelayMin}
              maxDelayMin={maxDelayMin}
              setMaxDelayMin={setMaxDelayMin}
              workStart={workStart}
              setWorkStart={setWorkStart}
              workEnd={workEnd}
              setWorkEnd={setWorkEnd}
              textVariations={textVariations}
              setTextVariations={setTextVariations}
              schedule={schedule}
              scheduleEnabled={scheduleEnabled}
              setScheduleEnabled={setScheduleEnabled}
              scheduleAt={scheduleAt}
              setScheduleAt={setScheduleAt}
              errors={errors}
            />
          )}
          {step === 'review' && (
            <StepReview
              name={name}
              post={selectedPost}
              groupIds={groupIds}
              groups={groups}
              dailyCap={dailyCap}
              minDelayMin={minDelayMin}
              maxDelayMin={maxDelayMin}
              workStart={workStart}
              workEnd={workEnd}
              textVariations={textVariations}
              schedule={schedule}
            />
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="secondary"
              icon={<ArrowRight size={16} />}
              onClick={goPrev}
              disabled={stepIdx === 0 || busy}
            >
              קודם
            </Button>
            {step !== 'review' ? (
              <Button onClick={goNext} icon={<ArrowLeft size={16} />} iconPosition="end">
                המשך
              </Button>
            ) : (
              <Button onClick={submit} loading={busy} icon={<Send size={16} />}>
                צור קמפיין
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== Step Components ===== */

function StepPost({
  name,
  setName,
  posts,
  postId,
  setPostId,
  errors,
}: {
  name: string;
  setName: (v: string) => void;
  posts: Post[];
  postId: ID | null;
  setPostId: (id: ID) => void;
  errors: Record<string, string>;
}) {
  return (
    <Card padded className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold mb-1">שם הקמפיין</h2>
        <p className="text-sm text-slate-500 mb-2">
          שם פנימי שיעזור לזהות את הקמפיין ברשימה.
        </p>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="למשל: השקת מוצר חדש - מאי"
          error={errors.name}
          autoFocus
          maxLength={80}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-1">בחירת פוסט</h2>
        <p className="text-sm text-slate-500 mb-3">
          הפוסט יישלח אל הקבוצות שתבחר בשלב הבא.
        </p>
        {errors.post && (
          <div className="text-sm text-red-600 mb-2 flex items-center gap-1">
            <AlertCircle size={14} />
            {errors.post}
          </div>
        )}
        {posts.length === 0 ? (
          <EmptyState
            icon={<ImageIcon size={24} />}
            title="אין פוסטים"
            description="כדי ליצור קמפיין צריך פוסט אחד לפחות."
            action={
              <Link href="/posts/new">
                <Button icon={<Plus size={14} />} size="sm">
                  צור פוסט חדש
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[28rem] overflow-y-auto pr-1">
            {posts.map((p) => {
              const selected = String(postId) === String(p.id);
              const src = imageSrc(p.imageUrl ?? p.image_path);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPostId(p.id)}
                  className={cn(
                    'flex gap-3 p-3 border rounded-lg text-right transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                    selected
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/20 ring-1 ring-brand-300'
                      : 'border-slate-200 dark:border-border hover:bg-slate-50 dark:hover:bg-surface-2'
                  )}
                >
                  <div
                    className={cn(
                      'shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center mt-1',
                      selected
                        ? 'border-brand-600 bg-brand-600'
                        : 'border-slate-300 dark:border-border'
                    )}
                  >
                    {selected && <Check size={12} className="text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    {src ? (
                      <img
                        src={src}
                        alt=""
                        className="w-full h-24 object-cover rounded mb-2 bg-slate-100"
                      />
                    ) : (
                      <div className="w-full h-24 rounded bg-gradient-to-br from-slate-50 to-slate-100 dark:from-surface-2 dark:to-surface flex items-center justify-center text-slate-300 mb-2">
                        <ImageIcon size={20} />
                      </div>
                    )}
                    <p className="text-xs text-slate-700 dark:text-foreground line-clamp-3 whitespace-pre-wrap leading-relaxed">
                      {p.text}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

function StepGroups({
  groups,
  groupedByTag,
  search,
  setSearch,
  groupIds,
  toggleGroup,
  setTagSelected,
  clearAll,
  errors,
}: {
  groups: Group[];
  groupedByTag: Array<[string, Group[]]>;
  search: string;
  setSearch: (v: string) => void;
  groupIds: Set<ID>;
  toggleGroup: (id: ID) => void;
  setTagSelected: (tag: string, gs: Group[], select: boolean) => void;
  clearAll: () => void;
  errors: Record<string, string>;
}) {
  const totalVisible = groupedByTag.reduce((acc, [, gs]) => acc + gs.length, 0);

  return (
    <Card padded className="space-y-3">
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-lg font-semibold">בחירת קבוצות</h2>
          <span className="text-sm text-slate-500 tabular-nums">
            {groupIds.size} מתוך {groups.length} נבחרו
          </span>
        </div>
        <p className="text-sm text-slate-500">
          רק קבוצות פעילות מוצגות. ניתן לסנן לפי תגית או טקסט.
        </p>
      </div>

      {errors.groups && (
        <div className="text-sm text-red-600 flex items-center gap-1">
          <AlertCircle size={14} />
          {errors.groups}
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon={<Users size={24} />}
          title="אין קבוצות פעילות"
          description="הוסף קבוצות בעמוד הקבוצות כדי להמשיך."
          action={
            <Link href="/groups">
              <Button size="sm" variant="secondary">
                לעמוד הקבוצות
              </Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חפש לפי שם, קישור או תגית..."
              icon={<Search size={16} />}
              className="flex-1 min-w-[16rem]"
            />
            {groupIds.size > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                נקה הכל
              </Button>
            )}
          </div>

          <div className="space-y-3 max-h-[26rem] overflow-y-auto -mx-1 px-1">
            {groupedByTag.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-sm">
                לא נמצאו קבוצות תואמות לחיפוש.
              </div>
            ) : (
              groupedByTag.map(([tag, gs]) => {
                const allSelected = gs.every((g) => groupIds.has(g.id));
                const someSelected = gs.some((g) => groupIds.has(g.id));
                return (
                  <div
                    key={tag}
                    className="border border-slate-200 dark:border-border rounded-lg overflow-hidden"
                  >
                    <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-surface-2 sticky top-0 z-10">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = !allSelected && someSelected;
                          }}
                          onChange={() => setTagSelected(tag, gs, !allSelected)}
                          className="w-4 h-4 cursor-pointer"
                          aria-label={`בחר את כל ${tag}`}
                        />
                        <Badge variant="secondary">{tag}</Badge>
                        <span className="text-xs text-slate-500 tabular-nums">
                          {gs.filter((g) => groupIds.has(g.id)).length} / {gs.length}
                        </span>
                      </div>
                    </div>
                    <div>
                      {gs.map((g) => {
                        const selected = groupIds.has(g.id);
                        return (
                          <label
                            key={g.id}
                            className={cn(
                              'flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors border-t border-slate-100 dark:border-border first:border-0',
                              selected
                                ? 'bg-brand-50/50 dark:bg-brand-950/20'
                                : 'hover:bg-slate-50 dark:hover:bg-surface-2'
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleGroup(g.id)}
                              className="w-4 h-4 cursor-pointer shrink-0"
                            />
                            <span className="flex-1 text-sm truncate">
                              {g.name || g.url}
                            </span>
                            {g.success_count + g.fail_count > 0 && (
                              <span className="text-xs text-slate-400 tabular-nums shrink-0">
                                {g.success_count}✓ · {g.fail_count}✕
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="text-xs text-slate-500 pt-1">
            {search ? `מציג ${totalVisible} מסוננות` : `סך הכל ${groups.length} קבוצות פעילות`}
          </div>
        </>
      )}
    </Card>
  );
}

function StepSettings({
  dailyCap,
  setDailyCap,
  minDelayMin,
  setMinDelayMin,
  maxDelayMin,
  setMaxDelayMin,
  workStart,
  setWorkStart,
  workEnd,
  setWorkEnd,
  textVariations,
  setTextVariations,
  schedule,
  scheduleEnabled,
  setScheduleEnabled,
  scheduleAt,
  setScheduleAt,
  errors,
}: {
  dailyCap: number;
  setDailyCap: (n: number) => void;
  minDelayMin: number;
  setMinDelayMin: (n: number) => void;
  maxDelayMin: number;
  setMaxDelayMin: (n: number) => void;
  workStart: number;
  setWorkStart: (n: number) => void;
  workEnd: number;
  setWorkEnd: (n: number) => void;
  textVariations: boolean;
  setTextVariations: (b: boolean) => void;
  schedule: { days: number; jobs: number };
  scheduleEnabled: boolean;
  setScheduleEnabled: (b: boolean) => void;
  scheduleAt: string;
  setScheduleAt: (v: string) => void;
  errors: Record<string, string>;
}) {
  // Default schedule value: tomorrow at 09:00 local
  const defaultScheduleVal = (() => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    t.setHours(9, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
  })();

  // Min for the input = now (rounded to current minute)
  const minScheduleVal = (() => {
    const t = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
  })();
  return (
    <div className="space-y-4">
      <Card padded className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold mb-1">הגדרות פרסום</h2>
          <p className="text-sm text-slate-500">
            ההגדרות נטענו מההגדרות הגלובליות שלך — ניתן לשנות לקמפיין הזה בלבד.
          </p>
        </div>

        <SliderField
          label="תקרה יומית"
          value={dailyCap}
          onChange={setDailyCap}
          min={1}
          max={100}
          unit="פוסטים ביום"
          help="כמה פוסטים מקסימום יישלחו ביום עבודה אחד. מעל 50 — סיכון מוגבר להגבלת חשבון."
          error={errors.cap}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SliderField
            label="השהיה מינימלית"
            value={minDelayMin}
            onChange={setMinDelayMin}
            min={0}
            max={120}
            unit="דקות"
          />
          <SliderField
            label="השהיה מקסימלית"
            value={maxDelayMin}
            onChange={setMaxDelayMin}
            min={0}
            max={120}
            unit="דקות"
          />
        </div>
        {errors.delay && (
          <div className="text-sm text-red-600 flex items-center gap-1">
            <AlertCircle size={14} />
            {errors.delay}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SliderField
            label="שעת התחלה"
            value={workStart}
            onChange={setWorkStart}
            min={0}
            max={23}
            unit=":00"
            unitPosition="suffix"
          />
          <SliderField
            label="שעת סיום"
            value={workEnd}
            onChange={setWorkEnd}
            min={0}
            max={23}
            unit=":00"
            unitPosition="suffix"
          />
        </div>
        {errors.hours && (
          <div className="text-sm text-red-600 flex items-center gap-1">
            <AlertCircle size={14} />
            {errors.hours}
          </div>
        )}

        <div className="flex items-start justify-between gap-3 p-3 bg-slate-50 dark:bg-surface-2 rounded-lg">
          <div>
            <div className="text-sm font-medium flex items-center gap-1.5">
              וריאציות טקסט
              <Tooltip content="בכל פרסום ייבחר שילוב אקראי מסוגריים מסולסלים בפוסט — מקטין סיכוי לזיהוי דפוסים על ידי פייסבוק.">
                <span className="text-xs text-slate-400 cursor-help">?</span>
              </Tooltip>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              מומלץ לבטיחות. דורש שימוש ב־{`{א|ב}`} בטקסט הפוסט.
            </p>
          </div>
          <Switch
            checked={textVariations}
            onCheckedChange={setTextVariations}
            aria-label="וריאציות טקסט"
          />
        </div>

        {/* Scheduled start */}
        <div className="p-3 bg-slate-50 dark:bg-surface-2 rounded-lg space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium flex items-center gap-1.5">
                תזמון התחלה
                <Tooltip content="במצב מופעל — הקמפיין יישאר במצב 'running' אך לא יתחיל לפרסם עד התאריך והשעה שתבחר.">
                  <span className="text-xs text-slate-400 cursor-help">?</span>
                </Tooltip>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {scheduleEnabled
                  ? 'הקמפיין ימתין עד למועד שתבחר ויתחיל לפרסם אוטומטית.'
                  : 'כבוי = הקמפיין מתחיל לפרסם מיד אחרי "צור קמפיין".'}
              </p>
            </div>
            <Switch
              checked={scheduleEnabled}
              onCheckedChange={(v) => {
                setScheduleEnabled(v);
                if (v && !scheduleAt) setScheduleAt(defaultScheduleVal);
              }}
              aria-label="תזמון התחלה"
            />
          </div>
          {scheduleEnabled && (
            <div className="space-y-2">
              <label
                htmlFor="schedule-at"
                className="block text-xs text-slate-600 dark:text-muted-foreground"
              >
                התחל בתאריך ובשעה
              </label>
              <input
                id="schedule-at"
                type="datetime-local"
                value={scheduleAt}
                min={minScheduleVal}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-border bg-white dark:bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-transparent"
              />
              {errors.schedule && (
                <div className="text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle size={14} />
                  {errors.schedule}
                </div>
              )}
              <p className="text-xs text-slate-500">
                שעון מקומי. ניתן לשנות לפני אישור הקמפיין.
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Schedule preview */}
      <Card padded className="bg-gradient-to-l from-brand-50 to-blue-50 dark:from-brand-950/30 dark:to-blue-950/30 border-brand-200 dark:border-brand-900">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-white/70 dark:bg-surface flex items-center justify-center text-brand-600">
            <SettingsIcon size={20} />
          </div>
          <div>
            <div className="text-sm font-semibold">צפי לוח זמנים</div>
            {schedule.jobs === 0 ? (
              <p className="text-sm text-slate-500 mt-1">
                בחר קבוצות בשלב הקודם כדי לראות צפי.
              </p>
            ) : (
              <p className="text-sm text-slate-700 dark:text-foreground mt-1">
                <strong className="tabular-nums">{schedule.jobs}</strong> פרסומים ב־
                <strong className="tabular-nums">{dailyCap}</strong> ליום
                {' = '}צפי סיום בעוד{' '}
                <strong className="tabular-nums">~{schedule.days}</strong>{' '}
                {schedule.days === 1 ? 'יום' : 'ימים'} בשעות{' '}
                <strong>
                  {workStart}:00–{workEnd}:00
                </strong>
                .
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function StepReview({
  name,
  post,
  groupIds,
  groups,
  dailyCap,
  minDelayMin,
  maxDelayMin,
  workStart,
  workEnd,
  textVariations,
  schedule,
}: {
  name: string;
  post: Post | null;
  groupIds: Set<ID>;
  groups: Group[];
  dailyCap: number;
  minDelayMin: number;
  maxDelayMin: number;
  workStart: number;
  workEnd: number;
  textVariations: boolean;
  schedule: { days: number; jobs: number };
}) {
  const selectedGroups = groups.filter((g) => groupIds.has(g.id));
  const tagBreakdown = new Map<string, number>();
  for (const g of selectedGroups) {
    const t = g.tag ?? 'ללא תגית';
    tagBreakdown.set(t, (tagBreakdown.get(t) ?? 0) + 1);
  }

  return (
    <Card padded className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold mb-1">סקירה אחרונה</h2>
        <p className="text-sm text-slate-500">
          וודא שהכל נכון. הקמפיין ייווצר כטיוטה — תוכל להפעיל אותו אחרי היצירה.
        </p>
      </div>

      <ReviewRow label="שם" value={name || <span className="text-red-600">—</span>} />

      <div className="border-t border-slate-100 dark:border-border pt-4">
        <div className="text-xs text-slate-500 mb-2">פוסט</div>
        {post ? (
          <div className="flex gap-3 p-3 border border-slate-200 dark:border-border rounded-lg">
            {imageSrc(post.imageUrl ?? post.image_path) ? (
              <img
                src={imageSrc(post.imageUrl ?? post.image_path)!}
                alt=""
                className="w-20 h-20 rounded object-cover bg-slate-100 shrink-0"
              />
            ) : (
              <div className="w-20 h-20 rounded bg-slate-100 dark:bg-surface-2 flex items-center justify-center text-slate-400 shrink-0">
                <ImageIcon size={20} />
              </div>
            )}
            <p className="text-sm text-slate-700 dark:text-foreground line-clamp-4 whitespace-pre-wrap leading-relaxed">
              {post.text}
            </p>
          </div>
        ) : (
          <div className="text-sm text-red-600">לא נבחר פוסט</div>
        )}
      </div>

      <div className="border-t border-slate-100 dark:border-border pt-4">
        <div className="text-xs text-slate-500 mb-2">
          קבוצות ({selectedGroups.length})
        </div>
        {tagBreakdown.size > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {Array.from(tagBreakdown.entries()).map(([tag, n]) => (
              <Badge key={tag} variant="secondary">
                {tag} · {n}
              </Badge>
            ))}
          </div>
        ) : (
          <div className="text-sm text-red-600">לא נבחרו קבוצות</div>
        )}
      </div>

      <div className="border-t border-slate-100 dark:border-border pt-4 grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
        <ReviewRow label="תקרה יומית" value={`${dailyCap} פוסטים`} compact />
        <ReviewRow
          label="השהיה"
          value={`${minDelayMin}–${maxDelayMin} דקות`}
          compact
        />
        <ReviewRow
          label="שעות פעילות"
          value={`${workStart}:00 – ${workEnd}:00`}
          compact
        />
        <ReviewRow
          label="וריאציות טקסט"
          value={textVariations ? 'כן' : 'לא'}
          compact
        />
      </div>

      <div className="bg-brand-50 dark:bg-brand-950/30 border border-brand-200 dark:border-brand-900 rounded-lg p-3 text-sm">
        <div className="font-medium mb-1">צפי סיום</div>
        <div className="text-slate-700 dark:text-foreground">
          {schedule.jobs > 0 ? (
            <>
              <strong className="tabular-nums">{schedule.jobs}</strong> פרסומים ב־
              <strong className="tabular-nums">~{schedule.days}</strong>{' '}
              {schedule.days === 1 ? 'יום' : 'ימי עבודה'}.
            </>
          ) : (
            'לא ניתן לחשב — חסרים נתונים.'
          )}
        </div>
      </div>
    </Card>
  );
}

function ReviewRow({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={compact ? '' : ''}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  unit,
  unitPosition = 'suffix',
  help,
  error,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  unit?: string;
  unitPosition?: 'prefix' | 'suffix';
  help?: string;
  error?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-sm font-semibold tabular-nums text-brand-700 dark:text-brand-300">
          {unitPosition === 'prefix' && unit && <span className="text-slate-400 text-xs">{unit} </span>}
          {value}
          {unitPosition === 'suffix' && unit && <span className="text-slate-400 text-xs"> {unit}</span>}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        value={value}
        onValueChange={onChange}
      />
      {help && <div className="text-xs text-slate-500 mt-1">{help}</div>}
      {error && (
        <div className="text-xs text-red-600 mt-1 flex items-center gap-1">
          <AlertCircle size={12} />
          {error}
        </div>
      )}
    </div>
  );
}
