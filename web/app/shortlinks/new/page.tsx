'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api';
import { toast } from '@/lib/toast';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { ArrowRight, Link2, Copy, Check } from '@/lib/icons';

interface CreatedShortlink {
  id: string;
  slug: string;
  url: string;
  target_url: string;
  label: string | null;
}

export default function NewShortlinkPage() {
  const router = useRouter();
  const [targetUrl, setTargetUrl] = useState('');
  const [label, setLabel] = useState('');
  const [customSlug, setCustomSlug] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedShortlink | null>(null);
  const [copied, setCopied] = useState(false);

  // Tiny UX touch: detect WhatsApp / wa.me / IG / general site and suggest a label.
  function suggestLabelFromUrl(url: string): string {
    if (!url) return '';
    if (/wa\.me|whatsapp\.com/i.test(url)) return 'ווטסאפ';
    if (/instagram\.com/i.test(url)) return 'אינסטגרם';
    if (/facebook\.com/i.test(url)) return 'פייסבוק';
    if (/youtube\.com|youtu\.be/i.test(url)) return 'יוטיוב';
    if (/tiktok\.com/i.test(url)) return 'טיקטוק';
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      return host;
    } catch {
      return '';
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetUrl.trim()) {
      toast.error('נא להדביק כתובת יעד');
      return;
    }
    setSubmitting(true);
    try {
      const data = await apiPost<CreatedShortlink>('/api/shortlinks', {
        targetUrl: targetUrl.trim(),
        label: label.trim() || null,
        customSlug: customSlug.trim() || null,
      });
      setCreated(data);
      toast.success('הקישור נוצר!');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg ?? 'יצירה נכשלה');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyShort() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('לא הצלחנו להעתיק. סמן וקופי ידנית.');
    }
  }

  if (created) {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">הקישור מוכן 🎉</h1>
          <Link href="/shortlinks">
            <Button variant="ghost" icon={<ArrowRight size={16} />}>
              חזרה לרשימה
            </Button>
          </Link>
        </div>

        <Card padded className="space-y-4">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">
              הקישור הקצר שלך
            </div>
            <div className="flex items-center gap-2">
              <code
                dir="ltr"
                className="flex-1 text-base font-mono bg-surface-2 px-4 py-3 rounded-lg overflow-x-auto whitespace-nowrap"
              >
                {created.url}
              </code>
              <Button
                onClick={copyShort}
                icon={copied ? <Check size={16} /> : <Copy size={16} />}
              >
                {copied ? 'הועתק' : 'העתק'}
              </Button>
            </div>
          </div>

          <div className="text-sm text-muted-foreground border-t border-border pt-4">
            <span className="text-foreground font-medium">היעד: </span>
            <a
              href={created.target_url}
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 hover:underline break-all"
            >
              {created.target_url}
            </a>
            {created.label && (
              <div className="mt-1">
                <span className="text-foreground font-medium">תווית: </span>
                {created.label}
              </div>
            )}
          </div>
        </Card>

        <Card padded className="bg-brand-50 dark:bg-brand-950/30 border-brand-200/50 dark:border-brand-900/50">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900/50 grid place-items-center text-brand-700 dark:text-brand-300 flex-shrink-0">
              <Link2 size={16} />
            </div>
            <div className="text-sm">
              <div className="font-semibold mb-1">מה עכשיו?</div>
              <p className="text-muted-foreground leading-relaxed">
                הדבק את הקישור הזה בכל פוסט שתיצור. כשיוטמע בקמפיין, אנחנו
                ניצור אוטומטית גרסה ייחודית לכל קבוצה כדי שתוכל לראות בדיוק{' '}
                <span className="text-foreground font-medium">מאיזה קבוצה הגיעו הלחיצות</span>.
              </p>
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setCreated(null);
              setTargetUrl('');
              setLabel('');
              setCustomSlug('');
            }}
          >
            צור עוד אחד
          </Button>
          <Button onClick={() => router.push(`/shortlinks/${created.id}`)}>
            עבור לאנליטיקה
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">קישור קצר חדש</h1>
        <Link href="/shortlinks">
          <Button variant="ghost" icon={<ArrowRight size={16} />}>
            חזרה
          </Button>
        </Link>
      </div>

      <form onSubmit={submit}>
        <Card padded className="space-y-5">
          <div>
            <label className="text-sm font-medium block mb-1.5" htmlFor="target">
              כתובת יעד *
            </label>
            <Input
              id="target"
              dir="ltr"
              type="url"
              value={targetUrl}
              onChange={(e) => {
                setTargetUrl(e.target.value);
                if (!label) setLabel(suggestLabelFromUrl(e.target.value));
              }}
              placeholder="https://wa.me/972501234567 או https://example.com"
              required
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              ה-URL שמשתמשים יישלחו אליו אחרי הלחיצה. לינק לווטסאפ, אתר, פוסט או כל דבר אחר.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5" htmlFor="label">
              תווית (אופציונלי)
            </label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="למשל: ווטסאפ מבצע מאי"
              maxLength={120}
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              שם פנימי לזיהוי ברשימה ובאנליטיקה. לא נראה לגולשים.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5" htmlFor="slug">
              סלאג מותאם (אופציונלי)
            </label>
            <div className="flex items-center gap-2">
              <code
                dir="ltr"
                className="text-xs font-mono text-muted-foreground bg-surface-2 px-2 py-1.5 rounded"
              >
                /l/
              </code>
              <Input
                id="slug"
                dir="ltr"
                value={customSlug}
                onChange={(e) => setCustomSlug(e.target.value)}
                placeholder="may-sale"
                pattern="[a-zA-Z0-9_-]{3,30}"
                className="flex-1 font-mono"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              3-30 תווים: אותיות אנגלית, מספרים, מקף או קו תחתון. השאר ריק ויוצר אוטומטי.
            </p>
          </div>
        </Card>

        <div className="flex items-center justify-end gap-2 mt-4">
          <Link href="/shortlinks">
            <Button variant="ghost" type="button">
              ביטול
            </Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'יוצר…' : 'צור קישור'}
          </Button>
        </div>
      </form>
    </div>
  );
}
