'use client';
import { Card, CardContent } from '@/components/ui/Card';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';
import Sparkline from './Sparkline';

export interface StatCardProps {
  label: string;
  value: string | number;
  /** Smaller text shown after value (e.g. "/ 50") */
  suffix?: string;
  /** Optional trend hint, in percent (positive or negative) */
  trendPct?: number;
  /** Sparkline values */
  trend?: number[];
  /** Color hint for sparkline ("brand" by default) */
  tone?: 'brand' | 'emerald' | 'amber' | 'red' | 'slate';
  /** Optional explanation for tooltip */
  hint?: string;
  /** Optional icon node */
  icon?: React.ReactNode;
  className?: string;
}

const toneClass: Record<NonNullable<StatCardProps['tone']>, string> = {
  brand: 'text-brand-500',
  emerald: 'text-emerald-500',
  amber: 'text-amber-500',
  red: 'text-red-500',
  slate: 'text-slate-400',
};

export default function StatCard({
  label,
  value,
  suffix,
  trendPct,
  trend,
  tone = 'brand',
  hint,
  icon,
  className,
}: StatCardProps) {
  const trendUp = (trendPct ?? 0) >= 0;
  return (
    <Card className={cn('relative overflow-hidden transition-all duration-200 hover:shadow-md', className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <span className="truncate">{label}</span>
              {hint && (
                <Tooltip content={hint}>
                  <span aria-label="מה זה אומר?" className="cursor-help text-slate-400 hover:text-slate-600">
                    ?
                  </span>
                </Tooltip>
              )}
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-3xl font-bold tabular-nums tracking-tight">{value}</span>
              {suffix && <span className="text-sm text-slate-500 font-medium">{suffix}</span>}
            </div>
            {typeof trendPct === 'number' && (
              <div
                className={cn(
                  'mt-1 inline-flex items-center gap-0.5 text-[11px] font-semibold',
                  trendUp ? 'text-emerald-600' : 'text-red-600',
                )}
                aria-label={`${trendUp ? 'עליה' : 'ירידה'} של ${Math.abs(trendPct).toFixed(1)} אחוז`}
              >
                <span aria-hidden>{trendUp ? '▲' : '▼'}</span>
                <span>{Math.abs(trendPct).toFixed(1)}%</span>
              </div>
            )}
          </div>
          {icon && <div className={cn('shrink-0 opacity-70', toneClass[tone])}>{icon}</div>}
        </div>

        {trend && trend.length > 0 && (
          <div className={cn('mt-3', toneClass[tone])}>
            <Sparkline values={trend} width={220} height={32} ariaLabel={`מגמה: ${label}`} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
