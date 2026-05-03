'use client';

import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Dialog } from '@/components/ui/Dialog';
import { toast } from '@/lib/toast';
import { formatRelative } from '@/lib/format';
import { Plus, Trash, Check, AlertCircle, Eye, EyeOff } from '@/lib/icons';

interface WorkerTokenDto {
  id: string;
  name: string;
  createdAt?: string;
  created_at?: string;
  lastUsedAt?: string | null;
  last_used_at?: string | null;
  revokedAt?: string | null;
  revoked_at?: string | null;
}

interface CreatedToken {
  id: string;
  name: string;
  token: string;
}

function getCreated(t: WorkerTokenDto): string {
  return t.createdAt || t.created_at || '';
}
function getLastUsed(t: WorkerTokenDto): string | null {
  return t.lastUsedAt ?? t.last_used_at ?? null;
}
function getRevoked(t: WorkerTokenDto): string | null {
  return t.revokedAt ?? t.revoked_at ?? null;
}

export default function WorkerPage() {
  const [tokens, setTokens] = useState<WorkerTokenDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [acked, setAcked] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<WorkerTokenDto[]>('/api/worker-tokens');
      setTokens(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינה');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error('בבקשה תן שם לסוכן (למשל: "המחשב בבית")');
      return;
    }
    setCreating(true);
    try {
      const res = await apiPost<CreatedToken>('/api/worker-tokens', { name: name.trim() });
      setCreated(res);
      setRevealed(false);
      setAcked(false);
      setCopied(false);
      setName('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'יצירת הטוקן נכשלה');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string, tokenName: string) => {
    if (!confirm(`לבטל את הטוקן "${tokenName}"? לא ניתן לשחזר.`)) return;
    try {
      await apiDelete(`/api/worker-tokens/${id}`);
      toast.success('הטוקן בוטל');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'הביטול נכשל');
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
      toast.success('הטוקן הועתק ללוח');
    } catch {
      toast.error('העתקה נכשלה — סמן והעתק ידנית');
    }
  };

  const handleCloseDialog = () => {
    if (!acked && !confirm('סגירה תמחק את הטוקן לתמיד. בטוח?')) return;
    setCreated(null);
    setRevealed(false);
    setAcked(false);
    setCopied(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">סוכן (Worker)</h1>
        <p className="text-sm text-muted-foreground mt-1">
          הסוכן הוא תוכנה קטנה שרצה על המחשב שלך ושולטת בדפדפן הפייסבוק שלך. צור
          טוקן, התקן את הסוכן, והוא יבצע את הפרסומים בשמך.
        </p>
      </div>

      {/* Tokens list */}
      <Card>
        <CardHeader>
          <CardTitle>הטוקנים שלך</CardTitle>
          <CardDescription>
            כל מחשב שמריץ את הסוכן צריך טוקן ייחודי. אפשר לבטל בכל רגע.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Create form */}
          <div className="flex flex-col sm:flex-row gap-2 mb-5">
            <Input
              placeholder="שם הסוכן (למשל: מחשב במשרד)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              maxLength={80}
              disabled={creating}
              className="sm:max-w-md"
            />
            <Button onClick={handleCreate} disabled={creating || !name.trim()}>
              <Plus size={16} /> צור טוקן
            </Button>
          </div>

          {tokens === null && !error && (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          )}

          {error && (
            <div className="text-sm text-danger-700 bg-danger-50 border border-danger-100 rounded-lg p-3">
              {error}
            </div>
          )}

          {tokens && tokens.length === 0 && (
            <EmptyState
              title="עוד אין טוקנים"
              description="צור טוקן ראשון כדי להתחיל. תקבל קישור להתקנה ושלב פעולה ברור."
            />
          )}

          {tokens && tokens.length > 0 && (
            <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
              {tokens.map((t) => {
                const revoked = !!getRevoked(t);
                const lastUsed = getLastUsed(t);
                return (
                  <li
                    key={t.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{t.name}</span>
                        {revoked ? (
                          <Badge variant="neutral">בוטל</Badge>
                        ) : lastUsed ? (
                          <Badge variant="success">פעיל</Badge>
                        ) : (
                          <Badge variant="warning">טרם בשימוש</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        נוצר {formatRelative(getCreated(t))}
                        {lastUsed && <> · נראה לאחרונה {formatRelative(lastUsed)}</>}
                      </div>
                    </div>
                    {!revoked && (
                      <button
                        onClick={() => handleRevoke(t.id, t.name)}
                        className="p-2 rounded-md text-muted-foreground hover:bg-danger-50 hover:text-danger-700 transition-colors"
                        aria-label="בטל טוקן"
                        title="בטל טוקן"
                      >
                        <Trash size={16} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Install instructions */}
      <Card>
        <CardHeader>
          <CardTitle>איך מתקינים את הסוכן</CardTitle>
          <CardDescription>3 צעדים, לוקח כדקה.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4 text-sm">
            <Step n={1} title="הורד את הסוכן">
              <p className="text-muted-foreground mb-2">
                גרסת Windows — בקרוב גרסה ל-Mac.
              </p>
              <a
                href="/downloads/wizardposts-worker.zip"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
              >
                הורד wizardposts-worker.zip
              </a>
            </Step>
            <Step n={2} title="חלץ את הקובץ והעתק את הטוקן">
              <p className="text-muted-foreground">
                חלץ ל-<code className="px-1.5 py-0.5 rounded bg-surface-2 ltr-text">
                  C:\WizardPostsWorker
                </code>{' '}
                (או כל מקום אחר). פתח את הקובץ <code className="px-1.5 py-0.5 rounded bg-surface-2 ltr-text">.env</code>{' '}
                והדבק את הטוקן בשורה:
              </p>
              <pre className="mt-2 p-3 rounded-lg bg-slate-900 text-slate-100 text-xs ltr-text overflow-x-auto">
                <code>{`WORKER_TOKEN=wp_xxxxxxxxxxxxxxxxxxxxxxxx
SERVER_URL=https://wizardposts.app`}</code>
              </pre>
            </Step>
            <Step n={3} title="הפעל את הסוכן">
              <p className="text-muted-foreground">
                לחץ פעמיים על <code className="px-1.5 py-0.5 rounded bg-surface-2 ltr-text">start.bat</code>.
                בפעם הראשונה ייפתח חלון פייסבוק — התחבר רגיל. בעתיד הסוכן ירוץ ברקע
                והכל אוטומטי.
              </p>
            </Step>
          </ol>
        </CardContent>
      </Card>

      {/* Created token dialog */}
      <Dialog
        open={!!created}
        onOpenChange={(open) => !open && handleCloseDialog()}
        size="lg"
        title={
          <span className="flex items-center gap-2">
            <span className="w-7 h-7 grid place-items-center rounded-full bg-success-100 text-success-700">
              <Check size={16} />
            </span>
            הטוקן נוצר
          </span>
        }
        description="זו הפעם היחידה שתראה את הטוקן. אחרי שתסגור — אי אפשר לשחזר."
        closeOnOverlay={false}
        footer={
          <Button
            variant="primary"
            disabled={!acked}
            onClick={() => {
              setCreated(null);
              setRevealed(false);
              setAcked(false);
            }}
          >
            סיימתי
          </Button>
        }
      >
        <div className="space-y-4">
            <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-warning-800 text-sm flex gap-2 items-start">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">העתק עכשיו ושמור במקום בטוח.</div>
                <div className="text-xs mt-0.5">
                  אם איבדת — אפשר לבטל ולייצר חדש, אבל הסוכן יצטרך להתחבר שוב.
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                הטוקן של "{created?.name}"
              </label>
              <div className="relative">
                <pre className="p-3 pe-20 rounded-lg bg-slate-900 text-slate-100 font-mono text-sm break-all ltr-text">
                  <code>{revealed ? created?.token : '•'.repeat(48)}</code>
                </pre>
                <button
                  type="button"
                  onClick={() => setRevealed((v) => !v)}
                  className="absolute top-2 end-2 p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label={revealed ? 'הסתר' : 'הצג'}
                  title={revealed ? 'הסתר' : 'הצג'}
                >
                  {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <Button
              type="button"
              size="lg"
              variant={copied ? 'secondary' : 'primary'}
              className="w-full"
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <Check size={16} /> הועתק
                </>
              ) : (
                <>העתק טוקן</>
              )}
            </Button>

            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={acked}
                onChange={(e) => setAcked(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-border text-brand-600 focus:ring-brand-500"
              />
              <span className="text-muted-foreground">
                שמרתי את הטוקן במקום בטוח. אני מבין שלא אוכל לראות אותו שוב.
              </span>
            </label>
          </div>
      </Dialog>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <div className="shrink-0 w-8 h-8 rounded-full gradient-brand text-white grid place-items-center font-bold text-sm">
        {n}
      </div>
      <div className="flex-1 pt-0.5">
        <div className="font-semibold mb-1.5">{title}</div>
        {children}
      </div>
    </li>
  );
}
