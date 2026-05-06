'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { toast } from '@/lib/toast';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ArrowRight, Plus, Trash } from '@/lib/icons';

interface BrandKit {
  tone: string;
  audience: string;
  pillars: string[];
  hashtags: string[];
  imageStyle: string;
  cta: string;
  publishSlots: string[];
}

interface Loaded {
  id: string;
  pageName: string;
  fbPageId: string;
  active: boolean;
  brandKit: BrandKit;
  pillarLabels: Record<string, string>;
}

export default function PageSettingsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pageId = params.get('pageId');

  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pageId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const d = await apiGet<Loaded>(`/api/page/settings?pageId=${pageId}`);
        setData(d);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(msg ?? 'שגיאה בטעינת ההגדרות');
      } finally {
        setLoading(false);
      }
    })();
  }, [pageId]);

  function update<K extends keyof BrandKit>(key: K, value: BrandKit[K]) {
    setData((prev) =>
      prev ? { ...prev, brandKit: { ...prev.brandKit, [key]: value } } : prev,
    );
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/page/settings?pageId=${data.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brandKit: data.brandKit }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg);
      }
      toast.success('ההגדרות נשמרו');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg ?? 'שמירה נכשלה');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Skeleton className="h-8 w-1/3" />
        <Card padded><Skeleton className="h-24" /></Card>
        <Card padded><Skeleton className="h-32" /></Card>
      </div>
    );
  }

  if (!pageId || !data) {
    return (
      <EmptyState
        title={pageId ? 'הדף לא נמצא' : 'חסר pageId ב-URL'}
        description="חזור לחיבור הדף ובחר את הדף שברצונך לערוך."
        action={
          <Link href="/page/connect">
            <Button>לחיבור דף</Button>
          </Link>
        }
      />
    );
  }

  const bk = data.brandKit;

  return (
    <div className="space-y-5 max-w-3xl pb-12">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/page/connect" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
            <ArrowRight size={14} /> חיבור דפים
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{data.pageName}</h1>
          <p className="text-sm text-muted-foreground mt-1">הגדרות תוכן (Brand Kit)</p>
        </div>
      </div>

      {/* Tone & audience */}
      <Card padded className="space-y-4">
        <h2 className="font-semibold">קול וקהל</h2>

        <div>
          <label className="text-sm font-medium block mb-1.5">טון התוכן</label>
          <Textarea
            value={bk.tone}
            onChange={(e) => update('tone', e.target.value)}
            rows={3}
            maxLength={2000}
          />
          <p className="text-xs text-muted-foreground mt-1">
            ה-AI יקרא את זה לפני כל פוסט. דוגמה: "חמים, רגוע, נשי, בלי מילים גנריות".
          </p>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1.5">קהל יעד</label>
          <Textarea
            value={bk.audience}
            onChange={(e) => update('audience', e.target.value)}
            rows={2}
            maxLength={2000}
          />
        </div>

        <div>
          <label className="text-sm font-medium block mb-1.5">CTA ברירת מחדל</label>
          <Input
            value={bk.cta}
            onChange={(e) => update('cta', e.target.value)}
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground mt-1">
            הקריאה לפעולה שתופיע בסוף כל פוסט (לדוגמה: "להזמנת טיפול: WhatsApp").
          </p>
        </div>
      </Card>

      {/* Image style */}
      <Card padded className="space-y-4">
        <h2 className="font-semibold">סגנון תמונות</h2>
        <Textarea
          value={bk.imageStyle}
          onChange={(e) => update('imageStyle', e.target.value)}
          rows={4}
          maxLength={2000}
        />
        <p className="text-xs text-muted-foreground">
          ה-AI ישתמש בתיאור הזה לבניית prompt לתמונה. דוגמה: "טבעי, אור רך, גוונים אדמתיים, נרות, אבנים, ללא טקסט בתמונה".
        </p>
      </Card>

      {/* Hashtags */}
      <Card padded className="space-y-3">
        <h2 className="font-semibold">האשטגים</h2>
        <ListEditor
          items={bk.hashtags}
          onChange={(v) => update('hashtags', v)}
          placeholder="#עיסוי_הוליסטי"
          maxItems={15}
          dir="rtl"
        />
        <p className="text-xs text-muted-foreground">
          האשטגים שיצורפו לכל פוסט. בעברית — מומלץ עם _ (קו תחתון) במקום רווח.
        </p>
      </Card>

      {/* Publish slots */}
      <Card padded className="space-y-3">
        <h2 className="font-semibold">שעות פרסום יומיות</h2>
        <ListEditor
          items={bk.publishSlots}
          onChange={(v) => update('publishSlots', v)}
          placeholder="10:00"
          maxItems={6}
          dir="ltr"
          pattern={/^([0-1]\d|2[0-3]):[0-5]\d$/}
        />
        <p className="text-xs text-muted-foreground">
          פורמט HH:mm (24-שעות, אזור זמן ישראל). לוח השבוע מחליט באיזה pillar לכל slot.
        </p>
      </Card>

      {/* Pillars info (read-only for now) */}
      <Card padded>
        <h2 className="font-semibold mb-3">עמודי תוכן (Pillars)</h2>
        <p className="text-xs text-muted-foreground mb-3">
          ה-AI מסובב בין 6 סוגי תוכן לפי לוח שבועי קבוע. ב-MVP הזה כולם פעילים.
        </p>
        <ul className="space-y-1 text-sm">
          {bk.pillars.map((p) => (
            <li key={p} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-brand-500 rounded-full" />
              <span>{data.pillarLabels[p] ?? p}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Save */}
      <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-background border-t border-border flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => router.push('/page/connect')}>
          ביטול
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? 'שומר…' : 'שמור הגדרות'}
        </Button>
      </div>
    </div>
  );
}

function ListEditor({
  items,
  onChange,
  placeholder,
  maxItems,
  dir = 'rtl',
  pattern,
}: {
  items: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  maxItems: number;
  dir?: 'ltr' | 'rtl';
  pattern?: RegExp;
}) {
  const [draft, setDraft] = useState('');
  const canAdd =
    draft.trim().length > 0 && (!pattern || pattern.test(draft.trim())) && items.length < maxItems;

  function add() {
    if (!canAdd) return;
    onChange([...items, draft.trim()]);
    setDraft('');
  }
  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i));
  }

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item, i) => (
            <span
              key={`${item}-${i}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface-2 rounded-md text-sm"
              dir={dir}
            >
              <span className="font-mono text-xs">{item}</span>
              <button
                onClick={() => remove(i)}
                className="text-muted-foreground hover:text-red-500"
                aria-label="הסר"
                type="button"
              >
                <Trash size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {items.length < maxItems && (
        <div className="flex gap-2">
          <Input
            dir={dir}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
            placeholder={placeholder}
            className="flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={add}
            disabled={!canAdd}
            icon={<Plus size={14} />}
          >
            הוסף
          </Button>
        </div>
      )}
    </div>
  );
}
