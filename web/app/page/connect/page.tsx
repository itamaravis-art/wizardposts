'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { toast } from '@/lib/toast';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { FacebookConnect, ExternalLink, Settings, Inbox, Check } from '@/lib/icons';

interface PageRow {
  id: string;
  fbPageId: string;
  pageName: string;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export default function PageConnectPage() {
  const router = useRouter();
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await apiGet<PageRow[]>('/api/page/connect');
      setPages(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg ?? 'שגיאה בטעינת הדפים');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) {
      toast.error('הדבק User Access Token מ-Graph API Explorer');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiPost<{
        id: string;
        pageName: string;
        updated: boolean;
      }>('/api/page/connect', { token: token.trim() });
      toast.success(
        res.updated
          ? `הטוקן עודכן עבור ${res.pageName}`
          : `הדף ${res.pageName} חובר בהצלחה`,
      );
      setToken('');
      await load();
      // Send the user to settings to review the brand kit before any
      // post is generated tomorrow.
      router.push(`/page/settings?pageId=${res.id}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg ?? 'חיבור הדף נכשל');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">חיבור דף Facebook</h1>
        <p className="text-sm text-muted-foreground mt-1">
          חיבור הדף שלך ל-WizardPosts מאפשר פרסום אוטומטי של פוסטים יומיים שמיוצרים
          ע"י AI עם אישור ידני שלך לפני פרסום.
        </p>
      </div>

      {/* Connected pages */}
      <Card padded>
        <h2 className="font-semibold mb-3">דפים מחוברים</h2>
        {loading ? (
          <Skeleton className="h-12 w-full" />
        ) : pages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            עדיין לא חיברת דף. השתמש בטופס למטה.
          </p>
        ) : (
          <div className="space-y-2">
            {pages.map((p) => {
              const expSoon =
                p.expiresAt && new Date(p.expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000;
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <FacebookConnect size={16} className="text-brand-600" />
                      <span className="font-medium truncate">{p.pageName}</span>
                      {p.active ? (
                        <Badge variant="success">פעיל</Badge>
                      ) : (
                        <Badge variant="neutral">מושהה</Badge>
                      )}
                      {expSoon && (
                        <Badge variant="warning">טוקן עומד לפוג</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
                      <span>FB Page ID: {p.fbPageId}</span>
                      {p.expiresAt && (
                        <span>פוג ב-{formatRelative(p.expiresAt)}</span>
                      )}
                      <span>חובר {formatRelative(p.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/page/settings?pageId=${p.id}`}>
                      <Button size="sm" variant="ghost" icon={<Settings size={14} />}>
                        הגדרות
                      </Button>
                    </Link>
                    <Link href="/page/queue">
                      <Button size="sm" variant="secondary" icon={<Inbox size={14} />}>
                        תור אישורים
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Connect form */}
      <Card padded>
        <h2 className="font-semibold mb-1">חיבור דף חדש (או רענון טוקן קיים)</h2>
        <p className="text-sm text-muted-foreground mb-4">
          ה-WizardPosts יחליף את הטוקן הקצר-מועד לטוקן ארוך-מועד (~60 ימים) אוטומטית.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1.5" htmlFor="token">
              User Access Token (מ-Graph API Explorer)
            </label>
            <Input
              id="token"
              dir="ltr"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="EAAxxxx..."
              className="font-mono text-xs"
              required
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              לא Page Token — User Token עם הרשאות{' '}
              <code className="bg-surface-2 px-1 rounded">pages_show_list</code>,{' '}
              <code className="bg-surface-2 px-1 rounded">pages_manage_posts</code>,{' '}
              <code className="bg-surface-2 px-1 rounded">pages_read_engagement</code>.
            </p>
          </div>

          <div className="flex items-center justify-end">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'מחבר...' : 'חבר דף'}
            </Button>
          </div>
        </form>
      </Card>

      {/* Help block */}
      <Card padded className="bg-brand-50 dark:bg-brand-950/30 border-brand-200/50 dark:border-brand-900/50">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Check size={16} /> איך משיגים את הטוקן
        </h3>
        <ol className="text-sm space-y-1.5 text-foreground/80 list-decimal pr-5">
          <li>
            פתח{' '}
            <a
              href="https://developers.facebook.com/tools/explorer/"
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 hover:underline inline-flex items-center gap-1"
            >
              Graph API Explorer
              <ExternalLink size={12} />
            </a>
          </li>
          <li>בחר את ה-App שלך מהדרופדאון בפינה הימנית-עליונה</li>
          <li>"User Token" → "Add a Permission" → סמן: <code>pages_show_list</code>, <code>pages_manage_posts</code>, <code>pages_read_engagement</code></li>
          <li>"Generate Access Token" → אישור פייסבוק</li>
          <li>העתק את הטוקן שמופיע והדבק כאן ב-input</li>
        </ol>
      </Card>
    </div>
  );
}
