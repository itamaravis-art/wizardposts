'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Dialog } from '@/components/ui/Dialog';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { toast } from '@/lib/toast';
import { Check, ArrowLeft, Send, Eye, EyeOff } from '@/lib/icons';
import type { MeResponse } from '@/lib/types';

type StepKey = 'welcome' | 'token' | 'install' | 'connect';

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'welcome', label: 'ברוך הבא' },
  { key: 'token', label: 'יצירת טוקן' },
  { key: 'install', label: 'התקנה' },
  { key: 'connect', label: 'חיבור פייסבוק' },
];

interface CreatedToken {
  id: string;
  name: string;
  token: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = React.useState<StepKey>('welcome');
  const [tokenName, setTokenName] = React.useState('המחשב שלי');
  const [creating, setCreating] = React.useState(false);
  const [created, setCreated] = React.useState<CreatedToken | null>(null);
  const [revealed, setRevealed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [me, setMe] = React.useState<MeResponse | null>(null);

  const idx = STEPS.findIndex((s) => s.key === step);
  const progress = Math.round(((idx + 1) / STEPS.length) * 100);

  React.useEffect(() => {
    if (step !== 'install' && step !== 'connect') return;
    let alive = true;
    const tick = async () => {
      try {
        const data = await apiGet<MeResponse>('/api/me');
        if (alive) setMe(data);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [step]);

  const handleCreateToken = async () => {
    if (!tokenName.trim()) return;
    setCreating(true);
    try {
      const res = await apiPost<CreatedToken>('/api/worker-tokens', {
        name: tokenName.trim(),
      });
      setCreated(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'יצירת הטוקן נכשלה');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
      toast.success('הטוקן הועתק');
    } catch {
      toast.error('העתקה נכשלה');
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
          <span>שלב {idx + 1} מתוך {STEPS.length}</span>
          <span>{STEPS[idx]?.label}</span>
        </div>
        <ProgressBar value={progress} max={100} />
      </div>

      {step === 'welcome' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">ברוכים הבאים ל-WizardPosts</CardTitle>
            <CardDescription>
              נעבור 4 צעדים קצרים ותהיה מוכן לפרסם בקבוצות שלך.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ul className="space-y-3 text-sm">
              <Bullet>תיצור טוקן ייחודי לסוכן.</Bullet>
              <Bullet>תוריד תוכנה קטנה למחשב.</Bullet>
              <Bullet>תתחבר פעם אחת לפייסבוק שלך.</Bullet>
            </ul>
            <Button size="lg" onClick={() => setStep('token')}>
              <Send size={16} /> בוא נתחיל
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'token' && (
        <Card>
          <CardHeader>
            <CardTitle>צור טוקן לסוכן</CardTitle>
            <CardDescription>
              סיסמה ייחודית בין החשבון שלך לבין התוכנה במחשב.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">שם לזיהוי</label>
              <Input
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="לדוגמה: מחשב במשרד"
                maxLength={80}
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                לבחירתך — עוזר לזהות אם תהיה לך יותר מהתקנה אחת.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setStep('welcome')}>
                <ArrowLeft size={16} className="rotate-180" /> אחורה
              </Button>
              <Button onClick={handleCreateToken} disabled={creating || !tokenName.trim()}>
                {creating ? 'יוצר...' : 'צור טוקן'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'install' && (
        <Card>
          <CardHeader>
            <CardTitle>התקן את הסוכן במחשב</CardTitle>
            <CardDescription>3 צעדים. בערך דקה.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 text-sm">
            <ol className="space-y-4">
              <Step n={1} title="הורד את הסוכן">
                <a
                  href="/downloads/wizardposts-worker.zip"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors mt-1"
                >
                  הורד wizardposts-worker.zip
                </a>
              </Step>
              <Step n={2} title="חלץ והדבק את הטוקן בקובץ .env">
                <pre className="mt-2 p-3 rounded-lg bg-slate-900 text-slate-100 text-xs ltr-text overflow-x-auto">
                  <code>{`WORKER_TOKEN=הטוקן-שלך
SERVER_URL=https://wizardposts.app`}</code>
                </pre>
              </Step>
              <Step n={3} title="הפעל את start.bat">
                <p className="text-muted-foreground">
                  לחץ פעמיים. הסוכן יתחיל לרוץ ונראה אותו כאן.
                </p>
              </Step>
            </ol>

            <div
              className={
                'rounded-lg border p-3 text-sm flex items-center gap-2 transition-colors ' +
                (me?.worker_online
                  ? 'border-success-200 bg-success-50 text-success-800'
                  : 'border-border bg-surface-2 text-muted-foreground')
              }
            >
              <span
                className={
                  'w-2 h-2 rounded-full ' +
                  (me?.worker_online ? 'bg-success-500 animate-pulse-soft' : 'bg-slate-400')
                }
              />
              {me?.worker_online
                ? 'הסוכן מחובר! מעולה.'
                : 'מחפש סוכן... ברגע שתפעיל אותו זה יקפוץ ירוק.'}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setStep('token')}>
                <ArrowLeft size={16} className="rotate-180" /> אחורה
              </Button>
              <Button onClick={() => setStep('connect')} disabled={!me?.worker_online}>
                המשך
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'connect' && (
        <Card>
          <CardHeader>
            <CardTitle>חבר את הפייסבוק שלך</CardTitle>
            <CardDescription>
              הסוכן יפתח חלון פייסבוק במחשב שלך — התחבר רגיל וזהו.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div
              className={
                'rounded-lg border p-3 text-sm flex items-center gap-2 ' +
                (me?.fb_connected
                  ? 'border-success-200 bg-success-50 text-success-800'
                  : 'border-border bg-surface-2 text-muted-foreground')
              }
            >
              <span
                className={
                  'w-2 h-2 rounded-full ' +
                  (me?.fb_connected ? 'bg-success-500 animate-pulse-soft' : 'bg-slate-400')
                }
              />
              {me?.fb_connected
                ? `מחובר כ-${me.fb_user_name || 'משתמש פייסבוק'}`
                : 'מחכה לחיבור פייסבוק...'}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setStep('install')}>
                <ArrowLeft size={16} className="rotate-180" /> אחורה
              </Button>
              <Button onClick={() => router.push('/dashboard')} disabled={!me?.fb_connected}>
                <Check size={16} /> סיים והיכנס לדאשבורד
              </Button>
            </div>
            <Link
              href="/dashboard"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              דלג בינתיים
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Token reveal dialog */}
      <Dialog
        open={!!created}
        onOpenChange={(open) => !open && setCreated(null)}
        size="lg"
        title={
          <span className="flex items-center gap-2">
            <span className="w-7 h-7 grid place-items-center rounded-full bg-success-100 text-success-700">
              <Check size={16} />
            </span>
            הטוקן שלך
          </span>
        }
        description="העתק עכשיו — לא נציג אותו שוב."
        closeOnOverlay={false}
        footer={
          <Button
            onClick={() => {
              setCreated(null);
              setStep('install');
            }}
            disabled={!copied}
          >
            המשך להתקנה
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="relative">
            <pre className="p-3 pe-12 rounded-lg bg-slate-900 text-slate-100 font-mono text-sm break-all ltr-text">
              <code>{revealed ? created?.token : '•'.repeat(48)}</code>
            </pre>
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className="absolute top-2 end-2 p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-white/10"
              aria-label={revealed ? 'הסתר' : 'הצג'}
            >
              {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <Button
            size="lg"
            className="w-full"
            variant={copied ? 'secondary' : 'primary'}
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check size={16} /> הועתק
              </>
            ) : (
              'העתק טוקן'
            )}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 items-start">
      <span className="shrink-0 w-5 h-5 mt-0.5 grid place-items-center rounded-full bg-success-100 text-success-700">
        <Check size={12} />
      </span>
      <span>{children}</span>
    </li>
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
    <li className="flex gap-3">
      <div className="shrink-0 w-7 h-7 rounded-full gradient-brand text-white grid place-items-center font-bold text-xs">
        {n}
      </div>
      <div className="flex-1 pt-0.5">
        <div className="font-semibold mb-1">{title}</div>
        {children}
      </div>
    </li>
  );
}
