'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import type { Settings } from '@/lib/types';
import { msToMinutes, minutesToMs } from '@/lib/format';
import { cn } from '@/lib/cn';

import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Slider } from '@/components/ui/Slider';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { Tooltip } from '@/components/ui/Tooltip';
import { Dialog } from '@/components/ui/Dialog';

import { toast } from '@/lib/toast';
import {
  Check,
  AlertCircle,
  FacebookConnect,
  Settings as SettingsIcon,
  Clock,
  X,
} from '@/lib/icons';

interface FormState {
  daily_cap: number;
  min_delay_min: number;
  max_delay_min: number;
  work_start: number;
  work_end: number;
  max_fails: number;
  typing_min: number;
  typing_max: number;
}

function fromSettings(s: Settings): FormState {
  return {
    daily_cap: s.daily_cap,
    min_delay_min: msToMinutes(s.min_delay_ms),
    max_delay_min: msToMinutes(s.max_delay_ms),
    work_start: s.work_hours_start,
    work_end: s.work_hours_end,
    max_fails: s.max_consecutive_fails,
    typing_min: s.typing_min_ms,
    typing_max: s.typing_max_ms,
  };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  async function load() {
    try {
      const data = await apiGet<Settings>('/api/settings');
      setSettings(data);
      setForm(fromSettings(data));
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה בטעינת ההגדרות');
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Track dirty state
  const isDirty = useMemo(() => {
    if (!settings || !form) return false;
    const original = fromSettings(settings);
    return (Object.keys(form) as Array<keyof FormState>).some(
      (k) => form[k] !== original[k]
    );
  }, [settings, form]);

  // Validation
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!form) return e;
    if (form.min_delay_min > form.max_delay_min)
      e.delay = 'השהיה מינימלית חייבת להיות קטנה ממקסימלית';
    if (form.typing_min > form.typing_max)
      e.typing = 'הקלדה מינימלית חייבת להיות קטנה ממקסימלית';
    if (form.work_start >= form.work_end)
      e.hours = 'שעת התחלה חייבת להיות קטנה משעת סיום';
    return e;
  }, [form]);

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [k]: v } : prev));
  }

  function reset() {
    if (settings) setForm(fromSettings(settings));
  }

  async function save() {
    if (!form || !settings) return;
    if (Object.keys(errors).length > 0) {
      toast.error('יש שדות שצריכים תיקון');
      return;
    }
    setBusy(true);
    try {
      const updated = await apiPatch<Settings>('/api/settings', {
        daily_cap: form.daily_cap,
        min_delay_ms: minutesToMs(form.min_delay_min),
        max_delay_ms: minutesToMs(form.max_delay_min),
        work_hours_start: form.work_start,
        work_hours_end: form.work_end,
        max_consecutive_fails: form.max_fails,
        typing_min_ms: form.typing_min,
        typing_max_ms: form.typing_max,
      });
      setSettings(updated);
      setForm(fromSettings(updated));
      toast.success('השינויים נשמרו');
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה בשמירה');
    } finally {
      setBusy(false);
    }
  }

  async function disconnectFacebook() {
    setBusy(true);
    try {
      await apiPost('/api/settings/disconnect', {});
      toast.success('פייסבוק נותק');
      setDisconnectOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'שגיאה בניתוק');
    } finally {
      setBusy(false);
    }
  }

  if (!settings || !form) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl pb-20">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">הגדרות</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          ברירות מחדל גלובליות לקמפיינים. ניתן לדרוס לכל קמפיין בנפרד.
        </p>
      </div>

      <Tabs defaultValue="safety">
        <TabsList>
          <TabsTrigger value="safety">בטיחות</TabsTrigger>
          <TabsTrigger value="behavior">התנהגות</TabsTrigger>
          <TabsTrigger value="facebook">פייסבוק</TabsTrigger>
        </TabsList>

        {/* SAFETY */}
        <TabsContent value="safety">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>קצב ותקרה</CardTitle>
                <CardDescription>
                  קצב פרסום מומלץ לבטיחות חשבונך — נמוך הוא בטוח יותר.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <SliderField
                  label="תקרה יומית"
                  value={form.daily_cap}
                  onChange={(v) => update('daily_cap', v)}
                  min={1}
                  max={50}
                  unit="פוסטים ביום"
                  help="המספר המרבי של פרסומים ביום עבודה."
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <SliderField
                    label="השהיה מינימלית"
                    value={form.min_delay_min}
                    onChange={(v) => update('min_delay_min', v)}
                    min={0}
                    max={120}
                    unit="דקות"
                  />
                  <SliderField
                    label="השהיה מקסימלית"
                    value={form.max_delay_min}
                    onChange={(v) => update('max_delay_min', v)}
                    min={0}
                    max={120}
                    unit="דקות"
                  />
                </div>
                {errors.delay && <ErrorRow msg={errors.delay} />}
                <SliderField
                  label="מקסימום כשלונות רצופים"
                  value={form.max_fails}
                  onChange={(v) => update('max_fails', v)}
                  min={1}
                  max={10}
                  unit="כשלונות"
                  help="לאחר שיא של כשלונות רצופים — הקמפיין יושהה אוטומטית."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>שעות פעילות</CardTitle>
                <CardDescription>
                  פרסומים יישלחו רק בטווח השעות המוגדר.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <SliderField
                    label="שעת התחלה"
                    value={form.work_start}
                    onChange={(v) => update('work_start', v)}
                    min={0}
                    max={23}
                    unit=":00"
                    unitPosition="suffix"
                  />
                  <SliderField
                    label="שעת סיום"
                    value={form.work_end}
                    onChange={(v) => update('work_end', v)}
                    min={0}
                    max={23}
                    unit=":00"
                    unitPosition="suffix"
                  />
                </div>
                <div className="flex items-start gap-2 text-sm bg-slate-50 dark:bg-surface-2 rounded-lg p-3">
                  <Clock size={16} className="text-slate-500 mt-0.5 shrink-0" />
                  <span className="text-slate-700 dark:text-foreground">
                    טווח פעילות:{' '}
                    <strong>
                      {form.work_start}:00 – {form.work_end}:00
                    </strong>{' '}
                    (
                    <span className="tabular-nums">
                      {form.work_end - form.work_start}
                    </span>{' '}
                    שעות).
                  </span>
                </div>
                {errors.hours && <ErrorRow msg={errors.hours} />}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* BEHAVIOR */}
        <TabsContent value="behavior">
          <Card>
            <CardHeader>
              <CardTitle>מהירות הקלדה</CardTitle>
              <CardDescription>
                הסימולציה מקלידה את התוכן בקצב אנושי. ערכים גבוהים = הקלדה איטית
                ובטוחה יותר.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SliderField
                  label="זמן בין תווים מינימלי"
                  value={form.typing_min}
                  onChange={(v) => update('typing_min', v)}
                  min={10}
                  max={500}
                  step={10}
                  unit="ms"
                  unitPosition="suffix"
                />
                <SliderField
                  label="זמן בין תווים מקסימלי"
                  value={form.typing_max}
                  onChange={(v) => update('typing_max', v)}
                  min={10}
                  max={500}
                  step={10}
                  unit="ms"
                  unitPosition="suffix"
                />
              </div>
              {errors.typing && <ErrorRow msg={errors.typing} />}
              <div className="text-xs text-slate-500">
                הקלדה אופיינית: 50–150ms. מהירה מאוד: פחות מ־50ms (פחות בטוח).
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* FACEBOOK */}
        <TabsContent value="facebook">
          <Card>
            <CardHeader>
              <CardTitle>חיבור לפייסבוק</CardTitle>
              <CardDescription>
                החשבון בו ייעשה שימוש לפרסום קמפיינים.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settings.fb_connected ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center text-emerald-700 dark:text-emerald-300">
                      <Check size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-emerald-800 dark:text-emerald-200">
                        מחובר
                      </div>
                      <div className="text-sm text-emerald-700 dark:text-emerald-300 truncate">
                        {settings.fb_user_name ?? 'משתמש פייסבוק'}
                      </div>
                      {settings.fb_connected_at && (
                        <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                          מחובר מאז{' '}
                          {new Date(settings.fb_connected_at).toLocaleDateString(
                            'he-IL'
                          )}
                        </div>
                      )}
                    </div>
                    <Badge variant="success">פעיל</Badge>
                  </div>
                  <Button
                    variant="danger"
                    icon={<X size={16} />}
                    onClick={() => setDisconnectOpen(true)}
                  >
                    נתק חיבור
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
                  <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center text-amber-700 dark:text-amber-300">
                    <FacebookConnect size={20} />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-amber-800 dark:text-amber-200">
                      לא מחובר
                    </div>
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      חיבור לחשבון פייסבוק נדרש כדי להפעיל קמפיינים.
                    </p>
                  </div>
                  <a href="/connect">
                    <Button>חבר</Button>
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Sticky save bar */}
      {isDirty && (
        <div
          className={cn(
            'fixed bottom-0 inset-x-0 z-30',
            'bg-white/95 dark:bg-surface/95 backdrop-blur',
            'border-t border-slate-200 dark:border-border',
            'shadow-[0_-4px_16px_rgba(0,0,0,0.08)]',
            'animate-in slide-in-from-bottom-2'
          )}
        >
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-slate-700 dark:text-foreground">
                יש שינויים שלא נשמרו
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={reset} disabled={busy}>
                בטל שינויים
              </Button>
              <Button
                onClick={save}
                loading={busy}
                icon={<Check size={16} />}
                disabled={Object.keys(errors).length > 0}
              >
                שמור שינויים
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect confirm */}
      <Dialog
        open={disconnectOpen}
        onClose={() => !busy && setDisconnectOpen(false)}
        title="ניתוק מפייסבוק"
        description="לאחר ניתוק לא ניתן יהיה להפעיל קמפיינים חדשים עד לחיבור מחדש. קמפיינים פעילים יושהו."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDisconnectOpen(false)} disabled={busy}>
              ביטול
            </Button>
            <Button variant="danger" onClick={disconnectFacebook} loading={busy}>
              נתק
            </Button>
          </>
        }
      />
    </div>
  );
}

function ErrorRow({ msg }: { msg: string }) {
  return (
    <div className="text-sm text-red-600 flex items-center gap-1">
      <AlertCircle size={14} />
      {msg}
    </div>
  );
}

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  unitPosition = 'suffix',
  help,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  unitPosition?: 'prefix' | 'suffix';
  help?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-sm font-semibold tabular-nums text-brand-700 dark:text-brand-300">
          {unitPosition === 'prefix' && unit && (
            <span className="text-slate-400 text-xs">{unit} </span>
          )}
          {value}
          {unitPosition === 'suffix' && unit && (
            <span className="text-slate-400 text-xs"> {unit}</span>
          )}
        </span>
      </div>
      <Slider min={min} max={max} step={step} value={value} onValueChange={onChange} />
      {help && <div className="text-xs text-slate-500 mt-1">{help}</div>}
    </div>
  );
}
