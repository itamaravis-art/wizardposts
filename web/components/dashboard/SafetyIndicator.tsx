'use client';
import { Card, CardContent } from '@/components/ui/Card';
import { Tooltip } from '@/components/ui/Tooltip';
import { Check, X, FacebookConnect, AlertCircle } from '@/lib/icons';
import { cn } from '@/lib/cn';

export interface SafetyIndicatorProps {
  withinHours: boolean;
  workHoursStart: number;
  workHoursEnd: number;
  underDailyCap: boolean;
  todayCount: number;
  dailyCap: number;
  fbConnected: boolean;
  fbUserName?: string | null;
  className?: string;
}

interface RowProps {
  ok: boolean;
  label: string;
  detail: string;
  hint?: string;
  icon?: React.ReactNode;
}

function Row({ ok, label, detail, hint, icon }: RowProps) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={cn(
          'shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full ring-1',
          ok ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-red-50 text-red-700 ring-red-200',
        )}
        aria-hidden
      >
        {icon ?? (ok ? <Check size={14} /> : <X size={14} />)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-slate-800">{label}</span>
          {hint && (
            <Tooltip content={hint}>
              <span className="text-slate-400 text-xs cursor-help" aria-label="מה זה אומר?">
                ?
              </span>
            </Tooltip>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{detail}</p>
      </div>
    </li>
  );
}

export default function SafetyIndicator({
  withinHours,
  workHoursStart,
  workHoursEnd,
  underDailyCap,
  todayCount,
  dailyCap,
  fbConnected,
  fbUserName,
  className,
}: SafetyIndicatorProps) {
  const allOk = withinHours && underDailyCap && fbConnected;

  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-800">בטיחות וחיבור</h3>
          <span
            className={cn(
              'text-[11px] font-semibold px-2 py-0.5 rounded-full',
              allOk
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700',
            )}
            aria-live="polite"
          >
            {allOk ? 'הכל תקין' : 'דרושה תשומת לב'}
          </span>
        </div>
        <ul className="space-y-3">
          <Row
            ok={withinHours}
            label="בטווח שעות עבודה"
            detail={
              withinHours
                ? `המערכת פעילה כעת. שעות עבודה: ${workHoursStart}:00 — ${workHoursEnd}:00`
                : `מחוץ לשעות העבודה (${workHoursStart}:00 — ${workHoursEnd}:00). הפרסום יתחדש בשעות הפעילות.`
            }
            hint="פרסום מחוץ לשעות העבודה עלול להיראות חשוד לפייסבוק."
          />
          <Row
            ok={underDailyCap}
            label="מתחת למכסה היומית"
            detail={`היום פורסמו ${todayCount} מתוך ${dailyCap} מותרים.`}
            hint="המכסה היומית מגנה על החשבון מפני חסימות."
          />
          <Row
            ok={fbConnected}
            icon={fbConnected ? <FacebookConnect size={14} /> : <AlertCircle size={14} />}
            label="חיבור לפייסבוק"
            detail={
              fbConnected
                ? `מחובר${fbUserName ? ` כ-${fbUserName}` : ''}.`
                : 'לא מחובר. ללא חיבור פעיל המערכת לא תוכל לפרסם.'
            }
            hint="הסשן נשמר מקומית. ניתן להתנתק בכל עת."
          />
        </ul>
      </CardContent>
    </Card>
  );
}
