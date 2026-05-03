'use client';

import * as React from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { FacebookConnect, Check, AlertCircle } from '@/lib/icons';
import type { MeResponse } from '@/lib/types';

const POLL_MS = 5000;

export default function ConnectPage() {
  const [me, setMe] = React.useState<MeResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      const data = await apiGet<MeResponse>('/api/me');
      setMe(data);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const fbConnected = !!me?.fb_connected;
  const workerOnline = !!me?.worker_online;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">חיבור פייסבוק</h1>
        <p className="text-sm text-muted-foreground mt-1">
          חיבור פייסבוק נעשה דרך הסוכן (Worker) שמותקן על המחשב שלך — לא דרך
          האתר. זה שומר על האבטחה של החשבון שלך.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>סטטוס נוכחי</CardTitle>
          <CardDescription>מתעדכן אוטומטית כל מספר שניות.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <StatusRow
            label="סוכן (Worker) מותקן ורץ"
            ok={workerOnline}
            okText="מחובר"
            failText="לא מחובר"
          />
          <StatusRow
            label="חשבון פייסבוק מחובר דרך הסוכן"
            ok={fbConnected}
            okText={me?.fb_user_name ? `מחובר כ-${me.fb_user_name}` : 'מחובר'}
            failText="לא מחובר"
          />
        </CardContent>
      </Card>

      {!workerOnline ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle size={18} className="text-warning-600" />
              קודם — צריך להתקין את הסוכן
            </CardTitle>
            <CardDescription>
              בלי סוכן רץ במחשב, אי אפשר לחבר את הפייסבוק. זה לוקח דקה.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Link href="/worker">
                <Button>פתח את עמוד ה-Worker</Button>
              </Link>
              <Link href="/onboarding">
                <Button variant="secondary">הדרכה צעד-צעד</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : !fbConnected ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FacebookConnect size={18} className="text-brand-600" />
              חבר את חשבון הפייסבוק
            </CardTitle>
            <CardDescription>
              הסוכן רץ — חסר רק להתחבר לפייסבוק. הסוכן יפתח חלון בדפדפן שלך.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ol className="space-y-2 list-decimal list-inside text-muted-foreground">
              <li>פתח את חלון הסוכן במחשב שלך (אם הוא לא פתוח, הפעל מחדש את start.bat).</li>
              <li>לחץ על "חבר פייסבוק" בסוכן.</li>
              <li>ייפתח חלון של facebook.com — התחבר כרגיל.</li>
              <li>ברגע שתסיים, נראה את הסטטוס מתעדכן אוטומטית כאן.</li>
            </ol>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-success-200 bg-success-50/50">
          <CardContent className="p-5 flex items-center gap-3">
            <span className="w-9 h-9 rounded-full bg-success-100 text-success-700 grid place-items-center">
              <Check size={18} />
            </span>
            <div className="flex-1">
              <div className="font-semibold">הכל מוכן!</div>
              <div className="text-sm text-muted-foreground">
                הסוכן מחובר ואתה מחובר לפייסבוק. אפשר ליצור קמפיין.
              </div>
            </div>
            <Link href="/campaigns/new">
              <Button>צור קמפיין</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusRow({
  label,
  ok,
  okText,
  failText,
}: {
  label: string;
  ok: boolean;
  okText: string;
  failText: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-b-0">
      <div className="text-sm">{label}</div>
      <span
        className={
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ' +
          (ok
            ? 'bg-success-50 text-success-700 border-success-100'
            : 'bg-warning-50 text-warning-700 border-warning-100')
        }
      >
        {ok ? <Check size={12} /> : <AlertCircle size={12} />}
        {ok ? okText : failText}
      </span>
    </div>
  );
}
